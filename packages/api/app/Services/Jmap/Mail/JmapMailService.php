<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\JmapMethodException;
use App\Services\Mail\MailImapClient;
use App\Services\Mail\MailPrincipalIdentityService;
use App\Services\Mail\MailSmtpTransportConfig;
use PHPMailer\PHPMailer\PHPMailer;

/**
 * RFC 8621 Mailbox / Email / Thread / Identity / EmailSubmission over IMAP.
 */
final class JmapMailService
{
    public function __construct(
        private MailImapSession $session,
        private MailSyncStore $sync,
        private JmapBlobService $blobs,
    ) {}

    public function state(string $username, string $mailAccountId = MailIdCodec::ACCOUNT_PRIMARY): string
    {
        $this->ensureAllMailboxesCached($username, $mailAccountId);

        return MailStateCodec::compose($this->sync->snapshot($username, $mailAccountId));
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function mailboxGet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $mailboxes = $this->listMailboxes($username, $account);
        $state = $this->state($username, $account);
        $ids = $args['ids'] ?? null;
        $list = [];
        $notFound = [];
        if ($ids === null) {
            $list = array_values($mailboxes);
        } else {
            if (! is_array($ids)) {
                throw new JmapMethodException('invalidArguments', 'ids must be null or an array.');
            }
            foreach ($ids as $id) {
                if (! is_string($id) || ! isset($mailboxes[$id])) {
                    $notFound[] = is_string($id) ? $id : '';

                    continue;
                }
                $list[] = $mailboxes[$id];
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $list,
            'notFound' => array_values(array_filter($notFound)),
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function mailboxChanges(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $since = (string) ($args['sinceState'] ?? '');
        $current = $this->state($username, $account);
        if ($since !== '' && $since !== $current && ! MailStateCodec::isValid($since)) {
            throw new JmapMethodException('cannotCalculateChanges', 'sinceState is not a mail state string.');
        }

        $created = [];
        $updated = [];
        $destroyed = [];
        if ($since !== $current) {
            foreach ($this->listMailboxes($username, $account) as $id => $_) {
                $updated[] = $id;
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $since,
            'newState' => $current,
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function mailboxSet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $oldState = $this->state($username, $account);
        $created = [];
        $updated = [];
        $destroyed = [];
        $notCreated = [];
        $notUpdated = [];
        $notDestroyed = [];

        $create = is_array($args['create'] ?? null) ? $args['create'] : [];
        $update = is_array($args['update'] ?? null) ? $args['update'] : [];
        $destroy = is_array($args['destroy'] ?? null) && array_is_list($args['destroy']) ? $args['destroy'] : [];

        $conn = $this->session->connection($username, $account);
        $ref = $this->session->mailboxRef($username, $account);

        foreach ($create as $clientId => $object) {
            if (! is_array($object)) {
                $notCreated[$clientId] = ['type' => 'invalidProperties', 'description' => 'Mailbox create must be an object.'];

                continue;
            }
            $name = trim((string) ($object['name'] ?? ''));
            if ($name === '') {
                $notCreated[$clientId] = ['type' => 'invalidProperties', 'properties' => ['name']];

                continue;
            }
            $parentId = $object['parentId'] ?? null;
            $path = $name;
            if (is_string($parentId) && $parentId !== '') {
                $parsed = MailIdCodec::parseMailboxId($parentId);
                if ($parsed === null) {
                    $notCreated[$clientId] = ['type' => 'invalidProperties', 'properties' => ['parentId']];

                    continue;
                }
                $path = $parsed['mailbox'].'.'.$name;
            }
            if (! MailImapClient::createMailbox($conn, $ref, $path)) {
                $notCreated[$clientId] = ['type' => 'serverFail', 'description' => 'Could not create mailbox.'];

                continue;
            }
            $created[$clientId] = $this->mailboxObject($username, $account, $path);
        }

        foreach ($update as $id => $patch) {
            if (! is_string($id) || ! is_array($patch)) {
                continue;
            }
            $parsed = MailIdCodec::parseMailboxId($id);
            if ($parsed === null) {
                $notUpdated[$id] = ['type' => 'notFound'];

                continue;
            }
            $newName = isset($patch['name']) ? trim((string) $patch['name']) : null;
            $parentId = $patch['parentId'] ?? null;
            $target = $parsed['mailbox'];
            $wouldMove = ($newName !== null && $newName !== '')
                || (is_string($parentId) && $parentId !== '');
            if (strcasecmp($parsed['mailbox'], 'INBOX') === 0 && $wouldMove) {
                $notUpdated[$id] = ['type' => 'forbidden', 'description' => 'Cannot move the Inbox mailbox.'];

                continue;
            }
            if ($newName !== null && $newName !== '') {
                $slash = strrpos($target, '.');
                $prefix = $slash === false ? '' : substr($target, 0, $slash + 1);
                $target = $prefix.$newName;
            }
            if (is_string($parentId) && $parentId !== '') {
                $parent = MailIdCodec::parseMailboxId($parentId);
                if ($parent === null) {
                    $notUpdated[$id] = ['type' => 'invalidProperties', 'properties' => ['parentId']];

                    continue;
                }
                $base = $newName !== null && $newName !== '' ? $newName : (strrpos($parsed['mailbox'], '.') === false
                    ? $parsed['mailbox']
                    : substr($parsed['mailbox'], strrpos($parsed['mailbox'], '.') + 1));
                $target = $parent['mailbox'].'.'.$base;
            }
            if ($target !== $parsed['mailbox'] && ! MailImapClient::renameMailbox($conn, $ref, $parsed['mailbox'], $target)) {
                $notUpdated[$id] = ['type' => 'serverFail', 'description' => 'Could not rename mailbox.'];

                continue;
            }
            $updated[$id] = $this->mailboxObject($username, $account, $target);
        }

        foreach ($destroy as $id) {
            if (! is_string($id)) {
                continue;
            }
            $parsed = MailIdCodec::parseMailboxId($id);
            if ($parsed === null) {
                $notDestroyed[$id] = ['type' => 'notFound'];

                continue;
            }
            if (strcasecmp($parsed['mailbox'], 'INBOX') === 0) {
                $notDestroyed[$id] = ['type' => 'forbidden', 'description' => 'Cannot destroy the Inbox mailbox.'];

                continue;
            }
            if (! MailImapClient::deleteMailbox($conn, $ref, $parsed['mailbox'])) {
                $notDestroyed[$id] = ['type' => 'serverFail', 'description' => 'Could not destroy mailbox.'];

                continue;
            }
            $destroyed[] = $id;
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => $this->state($username, $account),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function emailQuery(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $filter = is_array($args['filter'] ?? null) ? $args['filter'] : [];
        $mailbox = 'INBOX';
        if (isset($filter['inMailbox']) && is_string($filter['inMailbox'])) {
            $parsed = MailIdCodec::parseMailboxId($filter['inMailbox']);
            if ($parsed === null) {
                throw new JmapMethodException('unsupportedFilter', 'inMailbox is not a mailbox id.');
            }
            $mailbox = $parsed['mailbox'];
        }
        $unsupported = array_diff(array_keys($filter), [
            'inMailbox', 'text', 'from', 'to', 'subject', 'hasKeyword', 'notKeyword', 'after', 'before',
        ]);
        if ($unsupported !== []) {
            throw new JmapMethodException('unsupportedFilter', 'Filter is not mapped to imap_search.');
        }

        $sort = $args['sort'] ?? [['property' => 'receivedAt', 'isAscending' => false]];
        if (! is_array($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be an array.');
        }
        foreach ($sort as $item) {
            $prop = is_array($item) ? ($item['property'] ?? '') : '';
            if (! in_array($prop, ['receivedAt', 'sentAt'], true)) {
                throw new JmapMethodException('unsupportedSort', 'Only receivedAt/sentAt sort is supported.');
            }
        }

        $position = max(0, (int) ($args['position'] ?? 0));
        $limit = min(200, max(1, (int) ($args['limit'] ?? 40)));

        $conn = $this->session->select($username, $mailbox, $account);
        $ref = $this->session->mailboxRef($username, $account);
        $criteria = $this->searchCriteria($filter);
        if ($criteria !== '') {
            $page = MailImapClient::searchUidsNewestFirstPaged($conn, $ref, $mailbox, $criteria, $limit, $position);
        } else {
            $page = MailImapClient::sortUidsNewestFirstPaged($conn, $ref, $mailbox, $limit, $position);
        }
        $status = MailImapClient::mailboxStatus($conn, $ref, $mailbox);
        $uidvalidity = (int) ($status['uidvalidity'] ?? 0);
        $ids = [];
        foreach ($page['uids'] as $uid) {
            $ids[] = MailIdCodec::emailId($account, $mailbox, $uidvalidity, $uid);
        }
        $this->sync->syncMailbox($username, $account, $mailbox, $conn, $ref);

        return [
            'accountId' => $username,
            'queryState' => $this->state($username, $account),
            'canCalculateChanges' => false,
            'position' => $position,
            'ids' => $ids,
            'total' => null,
            'limit' => $limit,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function emailGet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $ids = $args['ids'] ?? null;
        $list = [];
        $notFound = [];
        if (! is_array($ids) || $ids === []) {
            return [
                'accountId' => $username,
                'state' => $this->state($username, $account),
                'list' => [],
                'notFound' => is_array($ids) ? [] : [],
            ];
        }
        $fetchBodies = $this->wantsBodies($args);
        foreach ($ids as $id) {
            if (! is_string($id)) {
                continue;
            }
            $parsed = MailIdCodec::parseEmailId($id);
            if ($parsed === null || $parsed['mailAccountId'] !== $account) {
                $notFound[] = $id;

                continue;
            }
            try {
                $email = $this->loadEmail($username, $parsed, $fetchBodies);
            } catch (JmapMethodException $e) {
                if ($e->errorArgs()['type'] === 'notFound') {
                    $notFound[] = $id;

                    continue;
                }
                throw $e;
            }
            if ($email === null) {
                $notFound[] = $id;

                continue;
            }
            $list[] = $email;
        }

        return [
            'accountId' => $username,
            'state' => $this->state($username, $account),
            'list' => $list,
            'notFound' => $notFound,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function emailChanges(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $since = (string) ($args['sinceState'] ?? '');
        $this->ensureAllMailboxesCached($username, $account);
        $snapshot = $this->sync->snapshot($username, $account);
        $current = MailStateCodec::compose($snapshot);
        if ($since !== '' && $since !== $current) {
            if (! MailStateCodec::isValid($since)) {
                throw new JmapMethodException('cannotCalculateChanges', 'sinceState is not a mail state string.');
            }
            foreach ($snapshot as $mailbox => $row) {
                $conn = $this->session->select($username, $mailbox, $account);
                $ref = $this->session->mailboxRef($username, $account);
                $status = MailImapClient::mailboxStatus($conn, $ref, $mailbox);
                if ($status !== null && (int) $status['uidvalidity'] !== (int) $row['uidvalidity']) {
                    throw new JmapMethodException('cannotCalculateChanges', 'UIDVALIDITY changed.');
                }
            }
        }

        $created = [];
        $updated = [];
        $destroyed = [];
        $conn = $this->session->connection($username, $account);
        $ref = $this->session->mailboxRef($username, $account);
        foreach ($this->listMailboxNames($username, $account) as $mailbox) {
            $delta = $this->sync->syncMailbox($username, $account, $mailbox, $conn, $ref);
            $uv = $delta['uidvalidity'];
            foreach ($delta['created'] as $uid) {
                $created[] = MailIdCodec::emailId($account, $mailbox, $uv, $uid);
            }
            foreach ($delta['updated'] as $uid) {
                $updated[] = MailIdCodec::emailId($account, $mailbox, $uv, $uid);
            }
            foreach ($delta['destroyed'] as $uid) {
                $destroyed[] = MailIdCodec::emailId($account, $mailbox, $uv, $uid);
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $since,
            'newState' => $this->state($username, $account),
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function emailSet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $oldState = $this->state($username, $account);
        $created = [];
        $updated = [];
        $destroyed = [];
        $notCreated = [];
        $notUpdated = [];
        $notDestroyed = [];

        $create = is_array($args['create'] ?? null) ? $args['create'] : [];
        $update = is_array($args['update'] ?? null) ? $args['update'] : [];
        $destroy = is_array($args['destroy'] ?? null) && array_is_list($args['destroy']) ? $args['destroy'] : [];

        foreach ($create as $clientId => $object) {
            if (! is_array($object)) {
                $notCreated[$clientId] = ['type' => 'invalidProperties'];

                continue;
            }
            try {
                $created[$clientId] = $this->createDraft($username, $account, $object);
            } catch (JmapMethodException $e) {
                $notCreated[$clientId] = $e->errorArgs();
            }
        }

        foreach ($update as $id => $patch) {
            if (! is_string($id) || ! is_array($patch)) {
                continue;
            }
            try {
                $this->patchEmail($username, $account, $id, $patch);
                $updated[$id] = null;
            } catch (JmapMethodException $e) {
                $notUpdated[$id] = $e->errorArgs();
            }
        }

        foreach ($destroy as $id) {
            if (! is_string($id)) {
                continue;
            }
            try {
                $this->destroyEmail($username, $account, $id);
                $destroyed[] = $id;
            } catch (JmapMethodException $e) {
                $notDestroyed[$id] = $e->errorArgs();
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => $this->state($username, $account),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function threadGet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $this->ensureAllMailboxesCached($username, $account);
        $ids = $args['ids'] ?? null;
        $list = [];
        $notFound = [];
        if (! is_array($ids)) {
            return [
                'accountId' => $username,
                'state' => $this->state($username, $account),
                'list' => [],
                'notFound' => [],
            ];
        }
        foreach ($ids as $id) {
            if (! is_string($id) || $id === '') {
                continue;
            }
            $rows = $this->sync->messagesForThread($username, $account, $id);
            if ($rows === []) {
                $notFound[] = $id;

                continue;
            }
            $emailIds = [];
            foreach ($rows as $row) {
                $conn = $this->session->select($username, $row['mailbox'], $account);
                $ref = $this->session->mailboxRef($username, $account);
                $status = MailImapClient::mailboxStatus($conn, $ref, $row['mailbox']);
                $uv = (int) ($status['uidvalidity'] ?? 0);
                $emailIds[] = MailIdCodec::emailId($account, $row['mailbox'], $uv, $row['uid']);
            }
            $list[] = ['id' => $id, 'emailIds' => $emailIds];
        }

        return [
            'accountId' => $username,
            'state' => $this->state($username, $account),
            'list' => $list,
            'notFound' => $notFound,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function identityGet(string $username): array
    {
        $identity = MailPrincipalIdentityService::fetch($username);

        return [
            'accountId' => $username,
            'state' => 'identities-1',
            'list' => [[
                'id' => MailIdCodec::ACCOUNT_PRIMARY,
                'name' => $identity['displayName'],
                'email' => $identity['emailAddress'],
                'mayDelete' => false,
            ]],
            'notFound' => [],
        ];
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    public function emailSubmissionSet(string $username, array $args): array
    {
        $account = MailIdCodec::ACCOUNT_PRIMARY;
        $created = [];
        $notCreated = [];
        $create = is_array($args['create'] ?? null) ? $args['create'] : [];
        foreach ($create as $clientId => $object) {
            if (! is_array($object)) {
                $notCreated[$clientId] = ['type' => 'invalidProperties'];

                continue;
            }
            $identityId = $object['identityId'] ?? null;
            if (! is_string($identityId) || $identityId === '') {
                $notCreated[$clientId] = ['type' => 'invalidProperties', 'properties' => ['identityId']];

                continue;
            }
            $emailId = $object['emailId'] ?? null;
            if (! is_string($emailId) || $emailId === '') {
                $notCreated[$clientId] = ['type' => 'invalidProperties', 'properties' => ['emailId']];

                continue;
            }
            try {
                $created[$clientId] = $this->submitEmail($username, $account, $identityId, $emailId, $object);
            } catch (JmapMethodException $e) {
                $notCreated[$clientId] = $e->errorArgs();
            }
        }

        return [
            'accountId' => $username,
            'oldState' => 'sub-0',
            'newState' => 'sub-1',
            'created' => $created,
            'updated' => [],
            'destroyed' => [],
            'notCreated' => $notCreated,
            'notUpdated' => [],
            'notDestroyed' => [],
        ];
    }

    /**
     * Live IMAP fetch for mb- blob ids. Never copies into jmap_blobs.
     *
     * @return array{contents: string, mediaType: string}|null
     */
    public function downloadBlob(string $username, string $blobId): ?array
    {
        $parsed = MailIdCodec::parseBlobId($blobId);
        if ($parsed === null) {
            return null;
        }
        $email = $this->loadEmail($username, $parsed, false);
        if ($email === null) {
            return null;
        }
        $conn = $this->session->select($username, $parsed['mailbox'], $parsed['mailAccountId']);
        $msgno = MailImapClient::msgnoFromUid($conn, $parsed['uid']);
        $part = MailImapClient::fetchDecodedMimePart($conn, $msgno, $parsed['section']);
        if ($part === null) {
            $raw = MailImapClient::fetchPlainBody($conn, $msgno);

            return ['contents' => $raw, 'mediaType' => 'text/plain'];
        }

        return ['contents' => $part['bytes'], 'mediaType' => $part['mime']];
    }

    /**
     * @param  array{mailAccountId: string, mailbox: string, uidvalidity: int, uid: int}  $parsed
     * @return array<string, mixed>|null
     */
    private function loadEmail(string $username, array $parsed, bool $bodies): ?array
    {
        $conn = $this->session->select($username, $parsed['mailbox'], $parsed['mailAccountId']);
        $ref = $this->session->mailboxRef($username, $parsed['mailAccountId']);
        $status = MailImapClient::mailboxStatus($conn, $ref, $parsed['mailbox']);
        $liveUv = (int) ($status['uidvalidity'] ?? 0);
        if ($liveUv !== $parsed['uidvalidity']) {
            return null;
        }
        $this->sync->syncMailbox($username, $parsed['mailAccountId'], $parsed['mailbox'], $conn, $ref);
        $ovs = MailImapClient::fetchOverviews($conn, [$parsed['uid']]);
        if ($ovs === []) {
            return null;
        }
        $ov = $ovs[0];
        if (! is_object($ov)) {
            return null;
        }
        $mailboxId = MailIdCodec::mailboxId($parsed['mailAccountId'], $parsed['mailbox']);
        $id = MailIdCodec::emailId($parsed['mailAccountId'], $parsed['mailbox'], $parsed['uidvalidity'], $parsed['uid']);
        $threadKey = $this->sync->threadKeyFor($username, $parsed['mailAccountId'], $parsed['mailbox'], $parsed['uid'])
            ?? MailThreadKey::fromHeaders(
                (string) ($ov->message_id ?? ''),
                (string) ($ov->in_reply_to ?? ''),
                '',
                (string) ($ov->subject ?? ''),
                (string) ($ov->from ?? ''),
            );
        $keywords = [];
        if (! empty($ov->seen)) {
            $keywords['$seen'] = true;
        }
        if (! empty($ov->flagged)) {
            $keywords['$flagged'] = true;
        }
        if (! empty($ov->draft)) {
            $keywords['$draft'] = true;
        }
        $from = MailImapClient::parseFrom((string) ($ov->from ?? ''));
        $email = [
            'id' => $id,
            'blobId' => MailIdCodec::blobId($parsed['mailAccountId'], $parsed['mailbox'], $parsed['uidvalidity'], $parsed['uid'], 'TEXT'),
            'threadId' => $threadKey,
            'mailboxIds' => [$mailboxId => true],
            'keywords' => $keywords,
            'size' => (int) ($ov->size ?? 0),
            'receivedAt' => $this->isoDate((string) ($ov->date ?? '')),
            'sentAt' => $this->isoDate((string) ($ov->date ?? '')),
            'subject' => MailImapClient::decodeMimeHeaderLine((string) ($ov->subject ?? '')),
            'messageId' => array_values(array_filter([(string) ($ov->message_id ?? '')])),
            'inReplyTo' => array_values(array_filter([(string) ($ov->in_reply_to ?? '')])),
            'from' => [['name' => $from['name'], 'email' => $from['email']]],
            'to' => $this->parseAddressList((string) ($ov->to ?? '')),
            'cc' => $this->parseAddressList((string) ($ov->cc ?? '')),
            'preview' => '',
            'hasAttachment' => false,
            'textBody' => [],
            'htmlBody' => [],
            'attachments' => [],
            'bodyValues' => new \stdClass,
        ];
        $msgno = MailImapClient::msgnoFromUid($conn, $parsed['uid']);
        $st = $msgno > 0 ? @imap_fetchstructure($conn, $msgno) : false;
        if (is_object($st)) {
            $atts = MailImapClient::attachmentSummariesFromStructure($st);
            $email['hasAttachment'] = $atts !== [];
            foreach ($atts as $att) {
                $email['attachments'][] = [
                    'partId' => $att['part'],
                    'blobId' => MailIdCodec::blobId($parsed['mailAccountId'], $parsed['mailbox'], $parsed['uidvalidity'], $parsed['uid'], $att['part']),
                    'type' => $att['type'],
                    'name' => $att['name'],
                    'size' => $att['size'],
                    'disposition' => 'attachment',
                ];
            }
        }
        if ($bodies && $msgno > 0) {
            $content = MailImapClient::fetchMessageContent($conn, $msgno);
            $bodyValues = [];
            if ($content['plain'] !== '') {
                $bodyValues['1'] = ['value' => $content['plain'], 'isEncodingProblem' => false, 'isTruncated' => false];
                $email['textBody'][] = [
                    'partId' => '1',
                    'blobId' => MailIdCodec::blobId($parsed['mailAccountId'], $parsed['mailbox'], $parsed['uidvalidity'], $parsed['uid'], '1'),
                    'type' => 'text/plain',
                ];
            }
            if ($content['html'] !== '') {
                $bodyValues['2'] = ['value' => $content['html'], 'isEncodingProblem' => false, 'isTruncated' => false];
                $email['htmlBody'][] = [
                    'partId' => '2',
                    'blobId' => MailIdCodec::blobId($parsed['mailAccountId'], $parsed['mailbox'], $parsed['uidvalidity'], $parsed['uid'], '2'),
                    'type' => 'text/html',
                ];
            }
            $email['bodyValues'] = $bodyValues;
            $email['preview'] = mb_substr($content['plain'] !== '' ? $content['plain'] : strip_tags($content['html']), 0, 256);
        }

        return $email;
    }

    /**
     * @param  array<string, mixed>  $object
     * @return array<string, mixed>
     */
    private function createDraft(string $username, string $account, array $object): array
    {
        $mailboxIds = is_array($object['mailboxIds'] ?? null) ? $object['mailboxIds'] : [];
        $mailbox = 'Drafts';
        foreach (array_keys($mailboxIds) as $mid) {
            if (is_string($mid)) {
                $parsed = MailIdCodec::parseMailboxId($mid);
                if ($parsed !== null) {
                    $mailbox = $parsed['mailbox'];
                    break;
                }
            }
        }
        $rfc822 = $this->rfc822FromSetObject($username, $object);
        $conn = $this->session->connection($username, $account);
        $ref = $this->session->mailboxRef($username, $account);
        if (! MailImapClient::appendRfc822($conn, $ref, $mailbox, $rfc822, '\\Draft')) {
            throw new JmapMethodException('serverFail', 'Could not append draft.');
        }
        $this->session->select($username, $mailbox, $account);
        $status = MailImapClient::mailboxStatus($conn, $ref, $mailbox);
        $uid = max(1, ((int) ($status['uidnext'] ?? 1)) - 1);
        $uv = (int) ($status['uidvalidity'] ?? 0);

        return [
            'id' => MailIdCodec::emailId($account, $mailbox, $uv, $uid),
            'blobId' => MailIdCodec::blobId($account, $mailbox, $uv, $uid, 'TEXT'),
            'threadId' => MailThreadKey::fromHeaders('', '', '', (string) ($object['subject'] ?? ''), ''),
            'mailboxIds' => [MailIdCodec::mailboxId($account, $mailbox) => true],
        ];
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function patchEmail(string $username, string $account, string $id, array $patch): void
    {
        $parsed = MailIdCodec::parseEmailId($id);
        if ($parsed === null) {
            throw new JmapMethodException('notFound', 'Unknown email id.');
        }
        $email = $this->loadEmail($username, $parsed, false);
        if ($email === null) {
            throw new JmapMethodException('notFound', 'Email not found.');
        }
        $conn = $this->session->select($username, $parsed['mailbox'], $account);
        if (isset($patch['keywords']) && is_array($patch['keywords'])) {
            $seen = array_key_exists('$seen', $patch['keywords'])
                ? (bool) $patch['keywords']['$seen']
                : ! empty($email['keywords']['$seen']);
            $flagged = array_key_exists('$flagged', $patch['keywords'])
                ? (bool) $patch['keywords']['$flagged']
                : ! empty($email['keywords']['$flagged']);
            MailImapClient::setFlags($conn, $parsed['uid'], $seen, $flagged);
        }
        foreach ($patch as $key => $value) {
            if (! is_string($key) || ! str_starts_with($key, 'keywords/')) {
                continue;
            }
            $kw = substr($key, strlen('keywords/'));
            $seen = ! empty($email['keywords']['$seen']);
            $flagged = ! empty($email['keywords']['$flagged']);
            if ($kw === '$seen') {
                $seen = (bool) $value;
            }
            if ($kw === '$flagged') {
                $flagged = (bool) $value;
            }
            MailImapClient::setFlags($conn, $parsed['uid'], $seen, $flagged);
        }
        if (isset($patch['mailboxIds']) && is_array($patch['mailboxIds'])) {
            $targets = [];
            foreach ($patch['mailboxIds'] as $mid => $on) {
                if ($on && is_string($mid)) {
                    $mb = MailIdCodec::parseMailboxId($mid);
                    if ($mb !== null) {
                        $targets[] = $mb['mailbox'];
                    }
                }
            }
            if ($targets !== [] && $targets[0] !== $parsed['mailbox']) {
                $ref = $this->session->mailboxRef($username, $account);
                MailImapClient::moveUid($conn, $ref, $parsed['uid'], $targets[0]);
            }
        }
    }

    private function destroyEmail(string $username, string $account, string $id): void
    {
        $parsed = MailIdCodec::parseEmailId($id);
        if ($parsed === null) {
            throw new JmapMethodException('notFound', 'Unknown email id.');
        }
        if ($this->loadEmail($username, $parsed, false) === null) {
            throw new JmapMethodException('notFound', 'Email not found.');
        }
        $conn = $this->session->select($username, $parsed['mailbox'], $account);
        MailImapClient::deleteUid($conn, $parsed['uid']);
    }

    /**
     * @param  array<string, mixed>  $object
     * @return array<string, mixed>
     */
    private function submitEmail(string $username, string $account, string $identityId, string $emailId, array $object): array
    {
        $identities = $this->identityGet($username)['list'];
        $identity = null;
        foreach ($identities as $row) {
            if (($row['id'] ?? '') === $identityId) {
                $identity = $row;
                break;
            }
        }
        if ($identity === null) {
            throw new JmapMethodException('invalidProperties', 'Unknown identityId.');
        }
        $parsed = MailIdCodec::parseEmailId($emailId);
        if ($parsed === null) {
            throw new JmapMethodException('invalidProperties', 'Unknown emailId.');
        }
        $email = $this->loadEmail($username, $parsed, true);
        if ($email === null) {
            throw new JmapMethodException('invalidProperties', 'Email not found.');
        }
        $runtime = $this->session->runtime($username, $account);
        $mail = new PHPMailer(true);
        $transport = MailSmtpTransportConfig::normalize($runtime['smtp']);
        $mail->isSMTP();
        $mail->Host = $transport['host'];
        $mail->Port = $transport['port'];
        $mail->SMTPSecure = match ($transport['security']) {
            'ssl' => PHPMailer::ENCRYPTION_SMTPS,
            'starttls' => PHPMailer::ENCRYPTION_STARTTLS,
            default => '',
        };
        $mail->SMTPAuth = $transport['smtpAuth'];
        $mail->Username = $runtime['smtp']['username'];
        $mail->Password = $runtime['smtp']['password'];
        $mail->CharSet = 'UTF-8';
        $mail->setFrom((string) $identity['email'], (string) $identity['name']);
        foreach ($email['to'] as $addr) {
            if (is_array($addr) && ($addr['email'] ?? '') !== '') {
                $mail->addAddress((string) $addr['email'], (string) ($addr['name'] ?? ''));
            }
        }
        $envelope = is_array($object['envelope'] ?? null) ? $object['envelope'] : [];
        if (isset($envelope['rcptTo']) && is_array($envelope['rcptTo'])) {
            $mail->clearAddresses();
            foreach ($envelope['rcptTo'] as $rcpt) {
                $em = is_array($rcpt) ? (string) ($rcpt['email'] ?? '') : '';
                if ($em !== '') {
                    $mail->addAddress($em);
                }
            }
        }
        $mail->Subject = (string) ($email['subject'] ?? '');
        $plain = '';
        $html = '';
        $values = is_array($email['bodyValues']) ? $email['bodyValues'] : [];
        foreach ($values as $part) {
            if (! is_array($part)) {
                continue;
            }
            $plain = (string) ($part['value'] ?? $plain);
        }
        $mail->Body = $plain !== '' ? $plain : '(empty)';
        $mail->AltBody = $plain;
        try {
            $mail->send();
        } catch (\Throwable $e) {
            throw new JmapMethodException('serverFail', $e->getMessage());
        }

        return [
            'id' => 'sub-'.bin2hex(random_bytes(8)),
            'emailId' => $emailId,
            'identityId' => $identityId,
            'threadId' => $email['threadId'],
        ];
    }

    /**
     * @param  array<string, mixed>  $object
     */
    private function rfc822FromSetObject(string $username, array $object): string
    {
        $blobId = $object['blobId'] ?? null;
        if (is_string($blobId) && str_starts_with($blobId, 'jb-')) {
            $stored = $this->blobs->retrieve($username, $blobId);
            if ($stored !== null) {
                return $stored['contents'];
            }
        }
        $identity = MailPrincipalIdentityService::fetch($username);
        $from = $identity['emailAddress'] !== '' ? $identity['emailAddress'] : 'noreply@localhost';
        $to = $this->firstEmail($object['to'] ?? []);
        $subject = (string) ($object['subject'] ?? '');
        $body = '';
        if (isset($object['bodyValues']) && is_array($object['bodyValues'])) {
            foreach ($object['bodyValues'] as $part) {
                if (is_array($part) && isset($part['value'])) {
                    $body = (string) $part['value'];
                    break;
                }
            }
        }

        return "From: {$from}\r\nTo: {$to}\r\nSubject: {$subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$body}";
    }

    private function firstEmail(mixed $list): string
    {
        if (! is_array($list)) {
            return '';
        }
        foreach ($list as $row) {
            if (is_array($row) && isset($row['email'])) {
                return (string) $row['email'];
            }
        }

        return '';
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function listMailboxes(string $username, string $account): array
    {
        $conn = $this->session->connection($username, $account);
        $ref = $this->session->mailboxRef($username, $account);
        $raw = MailImapClient::listMailboxes($conn, $ref);
        $out = [];
        foreach ($raw as $row) {
            $mb = $row['mailbox'];
            $status = MailImapClient::mailboxStatus($conn, $ref, $mb) ?? [
                'unseen' => 0, 'messages' => 0, 'uidnext' => 0, 'uidvalidity' => 0,
            ];
            $this->sync->syncMailbox($username, $account, $mb, $conn, $ref);
            $id = MailIdCodec::mailboxId($account, $mb);
            $out[$id] = [
                'id' => $id,
                'name' => $row['name'],
                'parentId' => $this->parentMailboxId($account, $mb, $row['delimiter'] ?? '.'),
                'role' => $this->mailboxRole($mb),
                'sortOrder' => 0,
                'totalEmails' => $status['messages'],
                'unreadEmails' => $status['unseen'],
                'totalThreads' => $status['messages'],
                'unreadThreads' => $status['unseen'],
                'myRights' => [
                    'mayReadItems' => true,
                    'mayAddItems' => true,
                    'mayRemoveItems' => true,
                    'maySetSeen' => true,
                    'maySetKeywords' => true,
                    'mayCreateChild' => true,
                    'mayRename' => true,
                    'mayDelete' => $mb !== 'INBOX',
                    'maySubmit' => true,
                ],
                'isSubscribed' => true,
            ];
        }

        return $out;
    }

    /**
     * @return list<string>
     */
    private function listMailboxNames(string $username, string $account): array
    {
        $names = [];
        foreach ($this->listMailboxes($username, $account) as $row) {
            $parsed = MailIdCodec::parseMailboxId((string) $row['id']);
            if ($parsed !== null) {
                $names[] = $parsed['mailbox'];
            }
        }

        return $names;
    }

    private function ensureAllMailboxesCached(string $username, string $account): void
    {
        $this->listMailboxes($username, $account);
    }

    /**
     * @return array<string, mixed>
     */
    private function mailboxObject(string $username, string $account, string $mailbox): array
    {
        $all = $this->listMailboxes($username, $account);
        $id = MailIdCodec::mailboxId($account, $mailbox);

        return $all[$id] ?? [
            'id' => $id,
            'name' => $mailbox,
            'parentId' => null,
            'role' => $this->mailboxRole($mailbox),
            'sortOrder' => 0,
            'totalEmails' => 0,
            'unreadEmails' => 0,
            'totalThreads' => 0,
            'unreadThreads' => 0,
            'myRights' => ['mayReadItems' => true, 'mayAddItems' => true, 'mayRemoveItems' => true, 'maySetSeen' => true, 'maySetKeywords' => true, 'mayCreateChild' => true, 'mayRename' => true, 'mayDelete' => true, 'maySubmit' => true],
            'isSubscribed' => true,
        ];
    }

    private function parentMailboxId(string $account, string $mailbox, string $delimiter): ?string
    {
        $pos = strrpos($mailbox, $delimiter !== '' ? $delimiter : '.');
        if ($pos === false || $pos === 0) {
            return null;
        }

        return MailIdCodec::mailboxId($account, substr($mailbox, 0, $pos));
    }

    private function mailboxRole(string $mailbox): ?string
    {
        $n = strtolower($mailbox);

        return match (true) {
            $n === 'inbox' => 'inbox',
            str_contains($n, 'draft') => 'drafts',
            str_contains($n, 'sent') => 'sent',
            str_contains($n, 'trash') || str_contains($n, 'deleted') => 'trash',
            str_contains($n, 'junk') || str_contains($n, 'spam') => 'junk',
            str_contains($n, 'archive') => 'archive',
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $filter
     */
    private function searchCriteria(array $filter): string
    {
        $parts = [];
        if (! empty($filter['text']) && is_string($filter['text'])) {
            $parts[] = 'TEXT "'.MailImapClient::searchCriterionEscapeQuoted($filter['text']).'"';
        }
        if (! empty($filter['from']) && is_string($filter['from'])) {
            $parts[] = 'FROM "'.MailImapClient::searchCriterionEscapeQuoted($filter['from']).'"';
        }
        if (! empty($filter['to']) && is_string($filter['to'])) {
            $parts[] = 'TO "'.MailImapClient::searchCriterionEscapeQuoted($filter['to']).'"';
        }
        if (! empty($filter['subject']) && is_string($filter['subject'])) {
            $parts[] = 'SUBJECT "'.MailImapClient::searchCriterionEscapeQuoted($filter['subject']).'"';
        }
        if (($filter['hasKeyword'] ?? null) === '$seen') {
            $parts[] = 'SEEN';
        }
        if (($filter['notKeyword'] ?? null) === '$seen') {
            $parts[] = 'UNSEEN';
        }
        if (($filter['hasKeyword'] ?? null) === '$flagged') {
            $parts[] = 'FLAGGED';
        }
        if (($filter['hasKeyword'] ?? null) === '$draft') {
            $parts[] = 'DRAFT';
        }

        return trim(implode(' ', $parts));
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function wantsBodies(array $args): bool
    {
        $props = $args['properties'] ?? null;
        if ($props === null) {
            return true;
        }
        if (! is_array($props)) {
            return false;
        }

        return in_array('bodyValues', $props, true)
            || in_array('textBody', $props, true)
            || in_array('htmlBody', $props, true);
    }

    /**
     * @return list<array{name: string, email: string}>
     */
    private function parseAddressList(string $raw): array
    {
        if (trim($raw) === '') {
            return [];
        }
        $out = [];
        foreach (preg_split('/,/', $raw) ?: [] as $piece) {
            $parsed = MailImapClient::parseFrom(trim($piece));
            if ($parsed['email'] !== '') {
                $out[] = ['name' => $parsed['name'], 'email' => $parsed['email']];
            }
        }

        return $out;
    }

    private function isoDate(string $raw): string
    {
        if ($raw === '') {
            return gmdate('Y-m-d\\TH:i:s\\Z');
        }
        $ts = strtotime($raw);

        return gmdate('Y-m-d\\TH:i:s\\Z', $ts !== false ? $ts : time());
    }
}
