<?php

declare(strict_types=1);

namespace App\Services\Mail;

use App\Support\WgwSettings;
use IMAP\Connection;
use PHPMailer\PHPMailer\PHPMailer;

final class MailOperationService
{
    public function __construct(
        private MailCredentialService $credentials,
    ) {}

    /** @return array<string, mixed> */
    public function status(string $username): array
    {
        return $this->handleStatus($username);
    }

    /** @return array<string, mixed> */
    public function listFolders(string $username): array
    {
        return MailImapProcess::runJson('listFolders', $username, [], fn () => $this->handleFolders($username));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function createFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('createFolder', $username, $body, fn () => $this->handleFolderCreate($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function moveFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveFolder', $username, $body, fn () => $this->handleFolderMove($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function deleteFolder(string $username, array $body): array
    {
        return MailImapProcess::runJson('deleteFolder', $username, $body, fn () => $this->handleFolderDelete($username, $body));
    }

    /** @return array<string, mixed> */
    public function listMessages(string $username, array $query): array
    {
        return MailImapProcess::runJson('listMessages', $username, $query, fn () => $this->handleMessages($username, $query));
    }

    /** @return array<string, mixed> */
    public function listMessageAttachments(string $username, array $query): array
    {
        return MailImapProcess::runJson(
            'listMessageAttachments',
            $username,
            $query,
            fn () => $this->handleMessageAttachments($username, $query),
        );
    }

    /** @return array<string, mixed> */
    public function getMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('getMessage', $username, $query, fn () => $this->handleMessageGet($username, $query));
    }

    public function downloadAttachment(string $username, array $query): MailBinaryDownload
    {
        return MailImapProcess::runBinary(
            'downloadAttachment',
            $username,
            $query,
            fn () => $this->handleMessageAttachmentDownload($username, $query),
        );
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function patchMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('patchMessage', $username, $body, fn () => $this->handleMessagePatch($username, $body));
    }

    /** @param array<string, mixed> $query @return array<string, mixed> */
    public function deleteMessage(string $username, array $query): array
    {
        return MailImapProcess::runJson('deleteMessage', $username, $query, fn () => $this->handleMessageDelete($username, $query));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function moveMessage(string $username, array $body): array
    {
        return MailImapProcess::runJson('moveMessage', $username, $body, fn () => $this->handleMove($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function send(string $username, array $body): array
    {
        return MailImapProcess::runJson('send', $username, $body, fn () => $this->handleSend($username, $body));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    public function saveDraft(string $username, array $body): array
    {
        return MailImapProcess::runJson('saveDraft', $username, $body, fn () => $this->handleSaveDraft($username, $body));
    }

    private function handleStatus(string $username): array
    {
        $cfg = WgwSettings::normalized();
        $account = $this->credentials->loadAccount($username);
        $ext = ImapExtension::loaded();
        $serversConfigured = MailServerSettings::serversConfigured($cfg);
        $accountConfigured = MailCredentialService::isAccountConfigured($account);
        $smtp = MailSmtpTransportConfig::normalize(MailServerSettings::endpoints($cfg)['smtp']);

        return [
            'extImap' => $ext,
            'serversConfigured' => $serversConfigured,
            'accountConfigured' => $accountConfigured,
            'ready' => $ext && MailUserRuntime::isReady($cfg, $account),
            'configured' => $accountConfigured,
            'smtp' => [
                'host' => $smtp['host'],
                'port' => $smtp['port'],
                'security' => $smtp['security'],
                'tcpReachable' => MailSmtpTransportConfig::canReachTcp($smtp['host'], $smtp['port']),
            ],
        ];
    }

    private function handleFolders(string $username): array
    {
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $folders = [];
        $listError = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $raw = MailImapClient::listMailboxes($conn, $ref);
            $folders = self::buildFolderTree($raw);
            $folders = self::foldersWithUnreadCounts($conn, $ref, $folders, $raw);
        } catch (\Throwable $e) {
            $listError = $e->getMessage();
        } finally {
            @imap_close($conn);
        }
        if ($listError !== null) {
            throw new MailResponseException(503, ['error' => 'imap_mailboxes_failed', 'message' => $listError]);
        }

        return ['folders' => $folders];
    }

    /**
     * @param  list<array{name: string, mailbox: string, delimiter: string, noSelect?: bool}>  $raw
     * @return list<array<string, mixed>>
     */
    private function buildFolderTree(array $raw): array
    {
        $inboxMb = self::findInbox($raw);
        $byLower = self::mailboxCanonicalIndex($raw);
        $out = [];
        $virtual = [
            ['id' => '__starred__', 'name' => 'Starred', 'parentId' => null, 'virtual' => true],
        ];
        foreach ($virtual as $v) {
            $out[] = $v;
        }
        foreach ($raw as $row) {
            $mb = $row['mailbox'];
            $id = self::folderIdEncode($mb);
            $del = self::normalizeMailboxDelimiter($row['delimiter'] ?? '.');
            $pCanon = self::resolveParentByLongestListedPrefix($mb, $raw);
            if ($pCanon === null) {
                $pCanon = self::resolveParentMailboxForTree($mb, $del, $byLower);
            }
            $parentId = $pCanon !== null ? self::folderIdEncode($pCanon) : null;
            $sys = self::detectSystem($mb, $inboxMb);
            $out[] = [
                'id' => $id,
                'name' => self::folderDisplayName($row),
                'parentId' => $parentId,
                'system' => $sys,
            ];
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $folders
     * @param  list<array{name: string, mailbox: string, delimiter: string, noSelect?: bool}>  $raw
     * @return list<array<string, mixed>>
     */
    private function foldersWithUnreadCounts(Connection $conn, string $ref, array $folders, array $raw): array
    {
        $noSelect = [];
        foreach ($raw as $row) {
            if (($row['noSelect'] ?? false) === true) {
                $noSelect[$row['mailbox']] = true;
            }
        }
        foreach ($folders as $i => $f) {
            if (($f['virtual'] ?? false) === true) {
                continue;
            }
            $id = $f['id'] ?? '';
            if (! is_string($id) || $id === '') {
                continue;
            }
            $mb = self::folderIdDecode($id);
            if ($mb === '' || $mb === '__starred__') {
                continue;
            }
            if (isset($noSelect[$mb])) {
                $folders[$i]['unread'] = 0;

                continue;
            }
            $folders[$i]['unread'] = MailImapClient::statusUnseen($conn, $ref, $mb);
        }

        return $folders;
    }

    /**
     * @param  array{name: string, mailbox: string, delimiter: string}  $row
     */
    private function folderDisplayName(array $row): string
    {
        $mb = $row['mailbox'];
        $decoded = $row['name'];
        if (strtoupper($mb) === 'INBOX') {
            return $decoded !== '' ? $decoded : 'Inbox';
        }
        $del = self::normalizeMailboxDelimiter($row['delimiter'] ?? '.');
        $leaf = self::mailboxLeafSegment($mb, $del);

        return MailImapClient::decodeMailboxName($leaf);
    }

    private function normalizeMailboxDelimiter(string $delimiter): string
    {
        if (strlen($delimiter) === 1 && $delimiter !== '') {
            return $delimiter;
        }

        return '.';
    }

    /**
     * @return non-empty-string|null
     */
    private function parentMailboxPath(string $mailbox, string $delimiter): ?string
    {
        $del = self::normalizeMailboxDelimiter($delimiter);
        $pos = strrpos($mailbox, $del);
        if ($pos === false || $pos === 0) {
            return null;
        }
        $parent = substr($mailbox, 0, $pos);

        return $parent !== '' ? $parent : null;
    }

    /**
     * Last hierarchy segment (IMAP mailbox form, e.g. modified UTF-7).
     */
    private function mailboxLeafSegment(string $mailbox, string $delimiter): string
    {
        $del = self::normalizeMailboxDelimiter($delimiter);
        $pos = strrpos($mailbox, $del);
        if ($pos === false) {
            return $mailbox;
        }

        return substr($mailbox, $pos + strlen($del));
    }

    /**
     * Prefer the longest listed mailbox that is a strict case-insensitive prefix of {@code $mailbox}
     * and is followed by {@code /} or {@code .} (hierarchy boundary). Does not depend on delimiter metadata.
     *
     * @param  list<array{name: string, mailbox: string, delimiter: string}>  $raw
     */
    private function resolveParentByLongestListedPrefix(string $mailbox, array $raw): ?string
    {
        $mLen = strlen($mailbox);
        $best = null;
        $bestLen = -1;
        foreach ($raw as $row) {
            $k = $row['mailbox'];
            if (! is_string($k) || $k === '') {
                continue;
            }
            $lk = strlen($k);
            if ($lk === 0 || $lk >= $mLen) {
                continue;
            }
            if (strncasecmp($mailbox, $k, $lk) !== 0) {
                continue;
            }
            $sep = $mailbox[$lk] ?? '';
            if ($sep !== '/' && $sep !== '.') {
                continue;
            }
            if ($lk > $bestLen) {
                $bestLen = $lk;
                $best = $k;
            }
        }

        return $best;
    }

    /**
     * @param  list<array{name: string, mailbox: string, delimiter: string}>  $raw
     * @return array<string, string> lower(mailbox) => mailbox string as returned by IMAP (first occurrence wins)
     */
    private function mailboxCanonicalIndex(array $raw): array
    {
        $m = [];
        foreach ($raw as $row) {
            $mb = $row['mailbox'];
            if (! is_string($mb) || $mb === '') {
                continue;
            }
            $k = strtolower($mb);
            if (! isset($m[$k])) {
                $m[$k] = $mb;
            }
        }

        return $m;
    }

    /**
     * Walk up from {@code $startPath} using {@code $delimiter} until a mailbox exists in {@code $canonicalByLower}.
     *
     * @param  array<string, string>  $canonicalByLower
     */
    private function nearestListedAncestor(string $startPath, string $delimiter, array $canonicalByLower): ?string
    {
        $del = self::normalizeMailboxDelimiter($delimiter);
        $try = $startPath;
        if ($try === '') {
            return null;
        }
        while ($try !== '') {
            $hit = $canonicalByLower[strtolower($try)] ?? null;
            if (is_string($hit) && $hit !== '') {
                return $hit;
            }
            $pos = strrpos($try, $del);
            if ($pos === false || $pos === 0) {
                break;
            }
            $try = substr($try, 0, $pos);
        }

        return null;
    }

    /**
     * Resolve parent mailbox to one that actually exists in the LIST/LSUB result (case-insensitive),
     * skipping missing intermediates. Tries the row delimiter first, then {@code /} and {@code .} so a wrong
     * delimiter from the server does not orphan nested folders or mis-attach them in the UI.
     *
     * @param  array<string, string>  $canonicalByLower
     */
    private function resolveParentMailboxForTree(string $mailbox, string $rowDelimiter, array $canonicalByLower): ?string
    {
        $d0 = self::normalizeMailboxDelimiter($rowDelimiter);
        $tryDelims = [$d0];
        foreach (['/', '.'] as $d) {
            if ($d !== $d0) {
                $tryDelims[] = $d;
            }
        }
        foreach ($tryDelims as $d) {
            $ideal = self::parentMailboxPath($mailbox, $d);
            if ($ideal === null) {
                continue;
            }
            $resolved = self::nearestListedAncestor($ideal, $d, $canonicalByLower);
            if ($resolved !== null && strcasecmp($resolved, $mailbox) !== 0) {
                return $resolved;
            }
        }

        return null;
    }

    /**
     * @param  list<array{name: string, mailbox: string, delimiter: string}>  $raw
     */
    private function findInbox(array $raw): string
    {
        foreach ($raw as $row) {
            if (strtoupper($row['mailbox']) === 'INBOX') {
                return $row['mailbox'];
            }
        }

        return 'INBOX';
    }

    /**
     * @param  list<array{name: string, mailbox: string, delimiter: string}>  $raw
     */
    private function delimiterForMailbox(array $raw, string $mailbox): string
    {
        foreach ($raw as $row) {
            if (strcasecmp($row['mailbox'], $mailbox) === 0) {
                $d = $row['delimiter'] ?? '.';

                return is_string($d) && strlen($d) === 1 ? $d : '.';
            }
        }
        foreach ($raw as $row) {
            if (strtoupper($row['mailbox']) === 'INBOX') {
                $d = $row['delimiter'] ?? '.';

                return is_string($d) && strlen($d) === 1 ? $d : '.';
            }
        }

        return '.';
    }

    private function detectSystem(string $mb, string $inboxMb): ?string
    {
        $u = strtoupper($mb);
        if ($u === strtoupper($inboxMb)) {
            return 'inbox';
        }
        foreach (['SENT' => 'sent', 'DRAFT' => 'drafts', 'DRAFTS' => 'drafts', 'TRASH' => 'trash', 'JUNK' => 'spam', 'SPAM' => 'spam', 'ARCHIVE' => 'archive'] as $needle => $sys) {
            if ($u === $needle || str_ends_with($u, '.'.$needle)) {
                return $sys;
            }
        }
        foreach (['SENT ITEMS' => 'sent', 'DELETED ITEMS' => 'trash', 'BIN' => 'trash'] as $needle => $sys) {
            if (str_contains($u, str_replace(' ', '', $needle)) || str_contains($u, str_replace(' ', '_', $needle))) {
                return $sys;
            }
        }
        // Gmail (and similar): "[Gmail]/Sent Mail"
        if (preg_match('#\[GMAIL\]/(SENT MAIL|SENT)$#i', $mb)) {
            return 'sent';
        }
        // Gmail (and similar): "[Gmail]/Drafts"
        if (preg_match('#\[GMAIL\]/(DRAFTS|DRAFT)$#i', $mb)) {
            return 'drafts';
        }
        // Gmail (and similar): "[Gmail]/All Mail" is closest to "Archive"
        if (preg_match('#\[GMAIL\]/(ALL MAIL)$#i', $mb)) {
            return 'archive';
        }
        // Gmail (and similar): "[Gmail]/Trash"
        if (preg_match('#\[GMAIL\]/(TRASH)$#i', $mb)) {
            return 'trash';
        }
        // Gmail (and similar): "[Gmail]/Spam"
        if (preg_match('#\[GMAIL\]/(SPAM)$#i', $mb)) {
            return 'spam';
        }

        return null;
    }

    private function resolveSystemMailbox(Connection $conn, string $ref, string $sys): ?string
    {
        $raw = MailImapClient::listMailboxes($conn, $ref);
        $inboxMb = self::findInbox($raw);
        foreach ($raw as $row) {
            if (self::detectSystem($row['mailbox'], $inboxMb) === $sys) {
                return $row['mailbox'];
            }
        }

        return null;
    }

    /**
     * Append an RFC822 message to a detected system mailbox (Sent, Drafts, …).
     *
     * @param  array{displayName: string, emailAddress: string, imap: array, smtp: array}  $cred
     * @param  'drafts'|'sent'  $system
     */
    private function tryAppendRfc822ToSystemFolder(
        array $cred,
        string $rfc822,
        string $system,
        string $imapFlags,
        ?string &$outErr,
    ): void {
        $outErr = null;
        if (! ImapExtension::loaded() || ! function_exists('imap_append')) {
            $outErr = 'imap_extension_required';

            return;
        }
        $imapErr = null;
        $conn = MailImapClient::connect($cred['imap'], $imapErr);
        if ($conn === null) {
            $outErr = $imapErr ?? 'imap_connect';

            return;
        }
        try {
            if (function_exists('imap_errors')) {
                imap_errors();
            }
            if (function_exists('imap_alerts')) {
                imap_alerts();
            }
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $raw = MailImapClient::listMailboxes($conn, $ref);
            $inboxMb = self::findInbox($raw);
            $targetMb = null;
            foreach ($raw as $row) {
                if (self::detectSystem($row['mailbox'], $inboxMb) === $system) {
                    $targetMb = $row['mailbox'];
                    break;
                }
            }
            if ($targetMb === null) {
                $outErr = $system === 'sent' ? 'no_sent_mailbox' : 'no_drafts_mailbox';

                return;
            }
            $path = $ref.$targetMb;
            if (! @imap_append($conn, $path, $rfc822, $imapFlags)) {
                $outErr = imap_last_error() ?: 'imap_append_failed';
            }
        } finally {
            @imap_close($conn);
        }
    }

    /**
     * After SMTP send, append the same RFC822 message to the account’s Sent mailbox (best-effort).
     *
     * @param  array{displayName: string, emailAddress: string, imap: array, smtp: array}  $cred
     */
    private function tryAppendSentCopy(array $cred, string $rfc822, ?string &$outErr): void
    {
        self::tryAppendRfc822ToSystemFolder($cred, $rfc822, 'sent', '\\Seen', $outErr);
    }

    private function handleFolderCreate(string $username, array $j): array
    {

        $name = trim((string) ($j['name'] ?? ''));
        if ($name === '') {
            throw new MailResponseException(400, ['error' => 'name_required']);
        }
        $cred = $this->requireImap($username);
        $parentEnc = isset($j['parentMailbox']) && is_string($j['parentMailbox']) ? $j['parentMailbox'] : '';
        $parent = $parentEnc !== '' ? self::folderIdDecode($parentEnc) : '';
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $raw = MailImapClient::listMailboxes($conn, $ref);
            if ($parent !== '') {
                $del = self::delimiterForMailbox($raw, $parent);
                $full = $parent.$del.$name;
            } else {
                $full = $name;
            }
            if (! MailImapClient::createMailbox($conn, $ref, $full)) {
                $resp = [400, ['error' => 'create_failed', 'message' => imap_last_error() ?: '']];
            } else {
                $resp = [200, ['ok' => true, 'mailbox' => $full, 'id' => self::folderIdEncode($full)]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleFolderMove(string $username, array $j): array
    {

        $folderEnc = isset($j['folder']) && is_string($j['folder']) ? $j['folder'] : '';
        $fromMb = self::folderIdDecode($folderEnc);
        if ($fromMb === '' || strtoupper($fromMb) === 'INBOX' || $fromMb === '__starred__') {
            throw new MailResponseException(400, ['error' => 'cannot_move']);
        }
        $cred = $this->requireImap($username);
        $parentEnc = isset($j['parentMailbox']) && is_string($j['parentMailbox']) ? $j['parentMailbox'] : '';
        $parent = $parentEnc !== '' ? self::folderIdDecode($parentEnc) : '';
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $rawList = MailImapClient::listMailboxes($conn, $ref);
            $inboxMb = self::findInbox($rawList);
            if (self::detectSystem($fromMb, $inboxMb) !== null) {
                throw new MailResponseException(400, ['error' => 'cannot_move_system']);
            }
            if ($parent !== '') {
                $known = false;
                foreach ($rawList as $row) {
                    if (strcasecmp($row['mailbox'], $parent) === 0) {
                        $known = true;
                        break;
                    }
                }
                if (! $known) {
                    throw new MailResponseException(400, ['error' => 'parent_unknown']);
                }
            }
            $del = self::delimiterForMailbox($rawList, $fromMb);
            $leaf = self::mailboxLeafSegment($fromMb, $del);
            $newMb = $parent !== '' ? $parent.$del.$leaf : $leaf;
            if (strcasecmp($fromMb, $newMb) === 0) {
                return ['ok' => true, 'id' => self::folderIdEncode($fromMb)];
            }
            $fromLower = strtolower($fromMb);
            $delLower = strtolower($del);
            if ($parent !== '') {
                $parentLower = strtolower($parent);
                if ($parentLower === $fromLower || str_starts_with($parentLower, $fromLower.$delLower)) {
                    throw new MailResponseException(400, ['error' => 'invalid_parent']);
                }
            }
            if (! MailImapClient::renameMailbox($conn, $ref, $fromMb, $newMb)) {
                $resp = [400, ['error' => 'rename_failed', 'message' => imap_last_error() ?: '']];
            } else {
                $resp = [200, ['ok' => true, 'mailbox' => $newMb, 'id' => self::folderIdEncode($newMb)]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleFolderDelete(string $username, array $j): array
    {
        $enc = (string) ($j['folder'] ?? '');
        $mb = self::folderIdDecode($enc);
        if ($mb === '' || strtoupper($mb) === 'INBOX' || $mb === '__starred__') {
            throw new MailResponseException(400, ['error' => 'cannot_delete']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $rawList = MailImapClient::listMailboxes($conn, $ref);
            $inboxMb = self::findInbox($rawList);
            if (self::detectSystem($mb, $inboxMb) !== null) {
                throw new MailResponseException(400, ['error' => 'cannot_delete_system']);
            }
            if (! MailImapClient::deleteMailbox($conn, $ref, $mb)) {
                $resp = [400, ['error' => 'delete_failed', 'message' => imap_last_error() ?: '']];
            } else {
                $resp = [200, ['ok' => true]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleMessages(string $username, array $query): array
    {
        $folderEnc = (string) ($query['folder'] ?? '');
        $folder = self::folderIdDecode($folderEnc);
        if ($folder === '') {
            throw new MailResponseException(400, ['error' => 'mailbox_required']);
        }
        $cred = $this->requireImap($username);
        $limit = isset($query['limit']) ? (int) $query['limit'] : 40;
        $offset = isset($query['offset']) ? (int) $query['offset'] : 0;
        $limit = max(1, min(80, $limit));
        $offset = max(0, min(50000, $offset));
        $qRaw = isset($query['q']) && is_string($query['q']) ? trim($query['q']) : '';
        if (function_exists('mb_substr')) {
            $qRaw = mb_substr($qRaw, 0, 200);
        } elseif (strlen($qRaw) > 200) {
            $qRaw = substr($qRaw, 0, 200);
        }
        $unseenOnly = isset($query['unseen']) && (string) $query['unseen'] === '1';
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $inbox = 'INBOX';
            if (! MailImapClient::reopenMailbox($conn, $ref, $folder === '__starred__' ? $inbox : $folder)) {
                $resp = [400, ['error' => 'mailbox_open']];
            } else {
                if ($qRaw !== '') {
                    $esc = MailImapClient::searchCriterionEscapeQuoted($qRaw);
                    if ($folder === '__starred__') {
                        $crit = 'FLAGGED TEXT "'.$esc.'"';
                        $page = MailImapClient::searchUidsNewestFirstPaged($conn, $ref, $inbox, $crit, $limit, $offset);
                    } else {
                        $crit = 'TEXT "'.$esc.'"';
                        if ($unseenOnly) {
                            $crit = 'UNSEEN TEXT "'.$esc.'"';
                        }
                        $page = MailImapClient::searchUidsNewestFirstPaged($conn, $ref, $folder, $crit, $limit, $offset);
                    }
                } elseif ($folder === '__starred__') {
                    if ($unseenOnly) {
                        $page = MailImapClient::searchUidsNewestFirstPaged($conn, $ref, $inbox, 'FLAGGED UNSEEN', $limit, $offset);
                    } else {
                        $page = MailImapClient::searchFlaggedUidsPaged($conn, $ref, $inbox, $limit, $offset);
                    }
                } elseif ($unseenOnly) {
                    $page = MailImapClient::searchUidsNewestFirstPaged($conn, $ref, $folder, 'UNSEEN', $limit, $offset);
                } else {
                    $page = MailImapClient::sortUidsNewestFirstPaged($conn, $ref, $folder, $limit, $offset);
                }
                $uidsForOverview = $page['uids'];
                $hasMore = $page['hasMore'];
                $ov = MailImapClient::fetchOverviews($conn, $uidsForOverview);
                $messages = [];
                foreach ($ov as $o) {
                    if (! is_object($o)) {
                        continue;
                    }
                    $uid = (int) ($o->uid ?? 0);
                    if ($uid <= 0) {
                        continue;
                    }
                    $mbForMsg = $folder === '__starred__' ? $inbox : $folder;
                    $messages[] = self::overviewToMessage(
                        $o,
                        $mbForMsg,
                        $folder === '__starred__' ? '__starred__' : self::folderIdEncode($mbForMsg),
                    );
                }
                $resp = [200, ['messages' => $messages, 'hasMore' => $hasMore]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    /**
     * GET {@code messages/attachments?folder=…&uids=1,2,3} — MIME structure scan for list paperclips (after fast overview).
     */
    private function handleMessageAttachments(string $username, array $query): array
    {
        $folderEnc = (string) ($query['folder'] ?? '');
        $folder = self::folderIdDecode($folderEnc);
        if ($folder === '') {
            throw new MailResponseException(400, ['error' => 'mailbox_required']);
        }
        $cred = $this->requireImap($username);
        $uidsRaw = isset($query['uids']) && is_string($query['uids']) ? $query['uids'] : '';
        $uids = self::parseUidListParam($uidsRaw, 80);
        if ($uids === []) {
            return ['items' => []];
        }
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            $inbox = 'INBOX';
            if (! MailImapClient::reopenMailbox($conn, $ref, $folder === '__starred__' ? $inbox : $folder)) {
                $resp = [400, ['error' => 'mailbox_open']];
            } else {
                $mbForMsg = $folder === '__starred__' ? $inbox : $folder;
                $items = [];
                foreach ($uids as $uid) {
                    if ($uid <= 0) {
                        continue;
                    }
                    $items[] = [
                        'id' => self::folderIdEncode($mbForMsg).':'.$uid,
                        'attachments' => self::attachmentSummariesForUid($conn, $uid),
                    ];
                }
                $resp = [200, ['items' => $items]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    /**
     * @return list<int>
     */
    private function parseUidListParam(string $uidsRaw, int $max): array
    {
        $seen = [];
        foreach (explode(',', $uidsRaw) as $piece) {
            $piece = trim($piece);
            if ($piece === '' || ! ctype_digit($piece)) {
                continue;
            }
            $u = (int) $piece;
            if ($u <= 0) {
                continue;
            }
            $seen[$u] = true;
            if (count($seen) >= $max) {
                break;
            }
        }

        return array_map('intval', array_keys($seen));
    }

    /**
     * @param  list<array{id: string, name: string, size: int, type: string, part: string}>  $attachments
     */
    private function overviewToMessage(object $o, string $realMailbox, string $folderIdForUi, array $attachments = []): array
    {
        $fromRaw = isset($o->from) ? (string) $o->from : '';
        $from = MailImapClient::parseFrom($fromRaw);
        $toRaw = isset($o->to) ? (string) $o->to : '';
        $ccRaw = isset($o->cc) ? (string) $o->cc : '';
        $to = MailImapClient::parseAddressListHeader(self::decodeMimeHeader($toRaw));
        $cc = MailImapClient::parseAddressListHeader(self::decodeMimeHeader($ccRaw));
        $subject = isset($o->subject) ? self::decodeMimeHeader((string) $o->subject) : '(no subject)';
        $date = isset($o->date) ? date('c', strtotime((string) $o->date) ?: time()) : date('c');
        $seen = ! empty($o->seen);
        $flagged = ! empty($o->flagged);
        $uid = (int) ($o->uid ?? 0);
        $preview = isset($o->preview) ? (string) $o->preview : '';
        $subjectSnippet = mb_substr($subject, 0, 140);

        return [
            'id' => self::folderIdEncode($realMailbox).':'.$uid,
            'folderId' => $folderIdForUi,
            'mailbox' => $realMailbox,
            'from' => $from,
            'to' => $to,
            'cc' => $cc,
            'subject' => $subject,
            'preview' => self::previewPlainLine($preview, $subjectSnippet),
            'body' => '',
            'date' => $date,
            'read' => $seen,
            'starred' => $flagged,
            'attachments' => $attachments,
        ];
    }

    /**
     * @return list<array{id: string, name: string, size: int, type: string, part: string}>
     */
    private function attachmentSummariesForUid(Connection $conn, int $uid): array
    {
        $msgno = MailImapClient::msgnoFromUid($conn, $uid);
        if ($msgno <= 0) {
            return [];
        }
        $st = @imap_fetchstructure($conn, $msgno);
        if ($st === false || ! is_object($st)) {
            return [];
        }

        return MailImapClient::attachmentSummariesFromStructure($st);
    }

    private function decodeMimeHeader(string $s): string
    {
        if (function_exists('iconv_mime_decode')) {
            $d = @iconv_mime_decode($s, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');

            return is_string($d) ? $d : $s;
        }

        return $s;
    }

    private function previewPlainLine(string $preview, string $fallbackSubject): string
    {
        $s = $preview !== '' ? $preview : $fallbackSubject;
        if ($s === '') {
            return '';
        }
        if (preg_match('/<[a-z][\s\S]*>/i', $s) !== 1) {
            return $s;
        }
        $t = preg_replace(['/<style[\s\S]*?<\/style>/i', '/<script[\s\S]*?<\/script>/i', '/<[^>]+>/'], [' ', ' ', ' '], $s);
        if (! is_string($t)) {
            return mb_substr(trim(html_entity_decode(strip_tags($s), ENT_QUOTES | ENT_HTML5, 'UTF-8')), 0, 220);
        }
        $t = preg_replace('/\s+/u', ' ', trim($t));

        return mb_substr($t, 0, 220);
    }

    private function handleMessageGet(string $username, array $query): array
    {
        $folderEnc = (string) ($query['folder'] ?? '');
        $uid = is_numeric($query['uid'] ?? null) ? (int) $query['uid'] : 0;
        $inlineImages = false;
        if (isset($query['inline_images'])) {
            $iv = (string) $query['inline_images'];
            $inlineImages = $iv === '1' || strtolower($iv) === 'true';
        }
        $mb = self::folderIdDecode($folderEnc);
        if ($mb === '' || $uid <= 0) {
            throw new MailResponseException(400, ['error' => 'bad_params']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            if (! MailImapClient::reopenMailbox($conn, $ref, $mb)) {
                $resp = [404, ['error' => 'mailbox']];
            } else {
                $ov = imap_fetch_overview($conn, (string) $uid, \FT_UID);
                if ($ov === false || ! isset($ov[0]) || ! is_object($ov[0])) {
                    $resp = [404, ['error' => 'message']];
                } else {
                    $msg = self::overviewToMessage(
                        $ov[0],
                        $mb,
                        self::folderIdEncode($mb),
                        self::attachmentSummariesForUid($conn, $uid),
                    );
                    $msgno = MailImapClient::msgnoFromUid($conn, $uid);
                    // imap_fetch_overview / imap_headerinfo To/Cc are often truncated; parse raw RFC822 headers.
                    if ($msgno > 0) {
                        $hdr = MailImapClient::parseToCcFromFetchHeader($conn, $msgno);
                        if ($hdr['to'] !== [] || $hdr['cc'] !== []) {
                            $msg['to'] = $hdr['to'];
                            $msg['cc'] = $hdr['cc'];
                        } else {
                            $hi = @imap_headerinfo($conn, $msgno);
                            if (is_object($hi)) {
                                $toStr = isset($hi->toaddress) && is_string($hi->toaddress) ? trim($hi->toaddress) : '';
                                $ccStr = isset($hi->ccaddress) && is_string($hi->ccaddress) ? trim($hi->ccaddress) : '';
                                $msg['to'] = $toStr !== ''
                                    ? MailImapClient::parseAddressListHeader(self::decodeMimeHeader($toStr))
                                    : MailImapClient::normalizeAddressObjects($hi->to ?? null);
                                $msg['cc'] = $ccStr !== ''
                                    ? MailImapClient::parseAddressListHeader(self::decodeMimeHeader($ccStr))
                                    : MailImapClient::normalizeAddressObjects($hi->cc ?? null);
                            }
                        }
                    }
                    $content = MailImapClient::fetchMessageContent($conn, $msgno);
                    $msg['body'] = $content['plain'];
                    $html = $content['html'];
                    if ($html !== '' && $inlineImages) {
                        $html = MailImapClient::rewriteHtmlCidReferences($conn, $msgno, $html);
                    }
                    $msg['bodyHtml'] = $html !== '' ? $html : null;
                    $resp = [200, ['message' => $msg]];
                }
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleMessageAttachmentDownload(string $username, array $query): MailBinaryDownload
    {
        $folderEnc = (string) ($query['folder'] ?? '');
        $uid = is_numeric($query['uid'] ?? null) ? (int) $query['uid'] : 0;
        $part = is_string($query['part'] ?? null) ? trim($query['part']) : '';
        $mb = self::folderIdDecode($folderEnc);
        if ($mb === '' || $uid <= 0 || $part === '' || preg_match('/^[1-9][0-9]*(\.[1-9][0-9]*)*$/', $part) !== 1) {
            throw new MailResponseException(400, ['error' => 'bad_params']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            if (! MailImapClient::reopenMailbox($conn, $ref, $mb)) {
                $resp = [404, ['error' => 'mailbox']];
            } else {
                $msgno = MailImapClient::msgnoFromUid($conn, $uid);
                if ($msgno <= 0) {
                    $resp = [404, ['error' => 'message']];
                } else {
                    $summaries = self::attachmentSummariesForUid($conn, $uid);
                    $meta = null;
                    foreach ($summaries as $s) {
                        if (isset($s['part']) && $s['part'] === $part) {
                            $meta = $s;
                            break;
                        }
                    }
                    if ($meta === null) {
                        $resp = [404, ['error' => 'attachment']];
                    } else {
                        $got = MailImapClient::fetchDecodedMimePart($conn, $msgno, $part);
                        if ($got === null) {
                            $resp = [502, ['error' => 'fetch_failed']];
                        } else {
                            return new MailBinaryDownload(
                                $got['mime'],
                                isset($meta['name']) && is_string($meta['name']) ? $meta['name'] : 'attachment',
                                $got['bytes'],
                            );
                        }
                    }
                }
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleMessagePatch(string $username, array $j): array
    {

        $folderEnc = isset($j['folder']) && is_string($j['folder']) ? $j['folder'] : '';
        $uid = isset($j['uid']) && is_numeric($j['uid']) ? (int) $j['uid'] : 0;
        $mb = self::folderIdDecode($folderEnc);
        if ($mb === '' || $uid <= 0) {
            throw new MailResponseException(400, ['error' => 'bad_params']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            if (! MailImapClient::reopenMailbox($conn, $ref, $mb)) {
                $resp = [404, ['error' => 'mailbox']];
            } else {
                $ov = imap_fetch_overview($conn, (string) $uid, \FT_UID);
                if ($ov === false || ! isset($ov[0]) || ! is_object($ov[0])) {
                    $resp = [404, ['error' => 'message']];
                } else {
                    $flagged = ! empty($ov[0]->flagged);
                    $seen = ! empty($ov[0]->seen);
                    if (array_key_exists('read', $j)) {
                        $seen = (bool) $j['read'];
                    }
                    if (array_key_exists('starred', $j)) {
                        $flagged = (bool) $j['starred'];
                    }
                    MailImapClient::setFlags($conn, $uid, $seen, $flagged);
                    $resp = [200, ['ok' => true]];
                }
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleMessageDelete(string $username, array $query): array
    {
        $folderEnc = isset($query['folder']) && is_string($query['folder']) ? $query['folder'] : '';
        $uid = isset($query['uid']) && is_numeric($query['uid']) ? (int) $query['uid'] : 0;
        $mb = self::folderIdDecode($folderEnc);
        if ($mb === '' || $uid <= 0) {
            throw new MailResponseException(400, ['error' => 'bad_params']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            if (! MailImapClient::reopenMailbox($conn, $ref, $mb)) {
                $resp = [404, ['error' => 'mailbox']];
            } elseif (! MailImapClient::deleteUid($conn, $uid)) {
                $resp = [400, ['error' => 'delete_failed', 'message' => imap_last_error() ?: '']];
            } else {
                $resp = [200, ['ok' => true]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    private function handleMove(string $username, array $j): array
    {

        $fromEnc = isset($j['fromFolder']) && is_string($j['fromFolder']) ? $j['fromFolder'] : '';
        $toEnc = isset($j['toFolder']) && is_string($j['toFolder']) ? $j['toFolder'] : '';
        $uid = isset($j['uid']) && is_numeric($j['uid']) ? (int) $j['uid'] : 0;
        $from = self::folderIdDecode($fromEnc);
        $to = self::folderIdDecode($toEnc);
        $toSys = null;
        if ($to === '') {
            $t = strtolower(trim($toEnc));
            if (in_array($t, ['trash', 'archive', 'spam', 'sent', 'drafts', 'inbox'], true)) {
                $toSys = $t;
            }
        }
        if ($from === '' || ($to === '' && $toSys === null) || $uid <= 0 || $to === '__starred__') {
            throw new MailResponseException(400, ['error' => 'bad_params']);
        }
        $cred = $this->requireImap($username);
        $err = null;
        $conn = MailImapClient::connect($cred['imap'], $err);
        if ($conn === null) {
            throw new MailResponseException(503, ['error' => 'imap_connect', 'message' => $err ?? '']);
        }
        $resp = null;
        try {
            $ref = MailImapClient::mailboxRef($cred['imap']);
            if (! MailImapClient::reopenMailbox($conn, $ref, $from)) {
                $resp = [400, ['error' => 'mailbox']];
            } else {
                $target = $to;
                if ($target === '' && $toSys !== null) {
                    $resolved = self::resolveSystemMailbox($conn, $ref, $toSys);
                    if ($resolved === null || $resolved === '') {
                        $resp = [400, ['error' => 'no_target_mailbox', 'message' => 'No mailbox found for '.$toSys]];
                    } else {
                        $target = $resolved;
                    }
                }
                if ($resp === null && ! MailImapClient::moveUid($conn, $ref, $uid, $target)) {
                    $resp = [400, ['error' => 'move_failed', 'message' => imap_last_error() ?: '']];
                } elseif ($resp === null) {
                    $resp = [200, ['ok' => true]];
                }
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp === null) {
            throw new MailResponseException(500, ['error' => 'server_error']);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    /**
     * @param  mixed  $attachments  JSON {@code attachments}: list of {@code { filename, mimeType, contentBase64 }}
     */
    private function attachDecodedUploads(PHPMailer $mail, mixed $attachments): array
    {
        if (! is_array($attachments)) {
            return ['attached' => 0, 'skipped' => 0, 'totalBytes' => 0];
        }
        $maxFiles = 24;
        $maxPerFile = 15 * 1024 * 1024;
        $maxTotal = 40 * 1024 * 1024;
        $total = 0;
        $n = 0;
        $skipped = 0;
        foreach ($attachments as $a) {
            if ($n >= $maxFiles) {
                break;
            }
            if (! is_array($a)) {
                $skipped++;

                continue;
            }
            $name = isset($a['filename']) && is_string($a['filename']) ? $a['filename'] : 'attachment';
            $name = basename(str_replace(["\0", '\\'], '/', $name));
            if ($name === '' || $name === '.' || $name === '..') {
                $name = 'attachment';
            }
            $mime = isset($a['mimeType']) && is_string($a['mimeType']) && $a['mimeType'] !== ''
                ? $a['mimeType']
                : 'application/octet-stream';
            $b64 = isset($a['contentBase64']) && is_string($a['contentBase64'])
                ? preg_replace('/\s+/', '', $a['contentBase64'])
                : '';
            if (! is_string($b64) || $b64 === '') {
                $skipped++;

                continue;
            }
            $raw = base64_decode($b64, true);
            if ($raw === false || $raw === '') {
                $skipped++;

                continue;
            }
            $len = strlen($raw);
            if ($len > $maxPerFile || $total + $len > $maxTotal) {
                $skipped++;

                continue;
            }
            $total += $len;
            $mail->addStringAttachment($raw, $name, PHPMailer::ENCODING_BASE64, $mime);
            $n++;
        }

        return ['attached' => $n, 'skipped' => $skipped, 'totalBytes' => $total];
    }

    /**
     * Shared SMTP client configuration for building RFC822 via {@see PHPMailer::preSend()} (and for sending).
     *
     * @param  array{displayName: string, emailAddress: string, imap: array, smtp: array}  $cred
     * @return string Envelope From address used in {@see PHPMailer::setFrom()}
     */
    private function configureMailerSmtp(PHPMailer $mail, array $cred, int $smtpTimeout = 30): string
    {
        $transport = MailSmtpTransportConfig::normalize($cred['smtp']);
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->isSMTP();
        // Defaults are 300s each — wrong host/firewall makes POST hang until the browser gives up.
        $mail->Timeout = $smtpTimeout;
        $mail->getSMTPInstance()->Timelimit = $smtpTimeout;
        $mail->Host = $transport['host'];
        $mail->Port = $transport['port'];
        if ($transport['security'] === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($transport['security'] === 'starttls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mail->SMTPAutoTLS = false;
            $mail->SMTPSecure = '';
        }
        $mail->SMTPAuth = $transport['smtpAuth'];
        $mail->SMTPKeepAlive = false;
        $mail->Username = $cred['smtp']['username'];
        $mail->Password = $cred['smtp']['password'];
        if (! config('wgw.mail.smtp_verify_tls', true)) {
            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true,
                ],
            ];
        }
        $fromAddr = MailFromAddressResolver::resolve($cred);
        $mail->setFrom($fromAddr, $cred['displayName'] ?: '');

        return $fromAddr;
    }

    private function handleSend(string $username, array $j): array
    {
        $cred = MailUserRuntime::resolve($username, $this->credentials);
        if ($cred === null) {
            throw new MailResponseException(400, ['error' => 'smtp_not_configured']);
        }

        $to = trim((string) ($j['to'] ?? ''));
        $subject = trim((string) ($j['subject'] ?? ''));
        $body = (string) ($j['body'] ?? '');
        $cc = trim((string) ($j['cc'] ?? ''));
        $bcc = trim((string) ($j['bcc'] ?? ''));
        if ($to === '') {
            throw new MailResponseException(400, ['error' => 'to_required']);
        }
        $smtpTimeout = 30;
        $transport = MailSmtpTransportConfig::normalize($cred['smtp']);
        $appendErr = null;
        $attachReport = null;
        try {
            if (! MailSmtpTransportConfig::canReachTcp($transport['host'], $transport['port'], 5.0)) {
                throw new \RuntimeException(
                    'Cannot reach SMTP server at '.MailSmtpTransportConfig::describe($transport)
                    .'. Check Admin mail settings (host, port, security) and that PHP can reach the host.'
                );
            }
            @set_time_limit($smtpTimeout + 30);
            $mail = new PHPMailer(true);
            self::configureMailerSmtp($mail, $cred, $smtpTimeout);
            foreach (preg_split('/[,;]/', $to) ?: [] as $addr) {
                $addr = trim($addr);
                if ($addr !== '') {
                    $mail->addAddress($addr);
                }
            }
            if ($cc !== '') {
                foreach (preg_split('/[,;]/', $cc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addCC($addr);
                    }
                }
            }
            if ($bcc !== '') {
                foreach (preg_split('/[,;]/', $bcc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addBCC($addr);
                    }
                }
            }
            $mail->Subject = $subject !== '' ? $subject : '(no subject)';
            $mail->Body = $body;
            $mail->isHTML(false);
            $attachReport = self::attachDecodedUploads($mail, $j['attachments'] ?? null);
            if (! $mail->preSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            $sentMime = $mail->getSentMIMEMessage();
            if (! $mail->postSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            self::tryAppendSentCopy($cred, $sentMime, $appendErr);
        } catch (\Throwable $e) {
            throw $this->mailSendException($e, $transport);
        }
        $payload = ['ok' => true];
        if ($attachReport !== null) {
            $payload['attachment_report'] = $attachReport;
        }
        if ($appendErr !== null) {
            $payload['sent_copy_failed'] = $appendErr;
        }

        return $payload;
    }

    /**
     * Build RFC822 from the composer and append it to the account’s Drafts mailbox (IMAP {@code APPEND}).
     */
    private function handleSaveDraft(string $username, array $j): array
    {
        $cred = $this->requireImap($username);

        $to = trim((string) ($j['to'] ?? ''));
        $subject = trim((string) ($j['subject'] ?? ''));
        $body = (string) ($j['body'] ?? '');
        $cc = trim((string) ($j['cc'] ?? ''));
        $bcc = trim((string) ($j['bcc'] ?? ''));
        $smtpTimeout = 30;
        $appendErr = null;
        $attachReport = null;
        try {
            @set_time_limit($smtpTimeout + 30);
            $mail = new PHPMailer(true);
            $fromAddr = self::configureMailerSmtp($mail, $cred, $smtpTimeout);
            foreach (preg_split('/[,;]/', $to) ?: [] as $addr) {
                $addr = trim($addr);
                if ($addr !== '') {
                    $mail->addAddress($addr);
                }
            }
            if ($cc !== '') {
                foreach (preg_split('/[,;]/', $cc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addCC($addr);
                    }
                }
            }
            if ($bcc !== '') {
                foreach (preg_split('/[,;]/', $bcc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addBCC($addr);
                    }
                }
            }
            if (
                count($mail->getToAddresses()) + count($mail->getCcAddresses()) + count($mail->getBccAddresses()) < 1
            ) {
                // PHPMailer requires at least one recipient for preSend(); Bcc is omitted from SMTP MIME headers.
                $mail->addBCC($fromAddr);
            }
            $mail->AllowEmpty = true;
            $mail->Subject = $subject !== '' ? $subject : '(no subject)';
            $mail->Body = $body;
            $mail->isHTML(false);
            $attachReport = self::attachDecodedUploads($mail, $j['attachments'] ?? null);
            if (! $mail->preSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            $mime = $mail->getSentMIMEMessage();
            self::tryAppendRfc822ToSystemFolder($cred, $mime, 'drafts', '\\Draft', $appendErr);
        } catch (\Throwable $e) {
            throw new MailResponseException(400, ['error' => 'draft_failed', 'message' => $e->getMessage()]);
        }
        if ($appendErr !== null) {
            throw new MailResponseException(400, ['error' => 'draft_append_failed', 'message' => $appendErr]);
        }
        $payload = ['ok' => true];
        if ($attachReport !== null) {
            $payload['attachment_report'] = $attachReport;
        }

        return $payload;
    }

    /**
     * @return array{displayName: string, emailAddress: string, imap: array, smtp: array}|null
     */
    private function requireImap(string $username): array
    {
        if (! ImapExtension::loaded()) {
            throw new MailResponseException(503, ['error' => 'imap_extension_required']);
        }
        $cred = MailUserRuntime::resolve($username, $this->credentials);
        if ($cred === null) {
            throw new MailResponseException(400, ['error' => 'not_configured']);
        }

        return $cred;
    }

    public static function folderIdEncode(string $mailbox): string
    {
        return rtrim(strtr(base64_encode($mailbox), '+/', '-_'), '=');
    }

    public static function folderIdDecode(string $enc): string
    {
        if ($enc === '__starred__') {
            return '__starred__';
        }
        $b64 = strtr($enc, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad > 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);

        return is_string($raw) ? $raw : '';
    }

    /**
     * @param  array{host: string, port: int, security: string, smtpAuth: bool}|null  $transport
     */
    private function mailSendException(\Throwable $e, ?array $transport = null): MailResponseException
    {
        $message = trim($e->getMessage());
        if ($message === 'invalid_from_address') {
            return new MailResponseException(400, [
                'error' => 'invalid_from_address',
                'message' => 'Set a valid email on your account (Settings or Admin) or use a full email address as your mail login.',
            ]);
        }

        $endpoint = $transport !== null ? MailSmtpTransportConfig::describe($transport) : '';
        $connectFailed = stripos($message, 'Could not connect') !== false
            || stripos($message, 'Failed to connect') !== false
            || stripos($message, 'Cannot reach SMTP') !== false;

        if ($connectFailed && $endpoint !== '') {
            return new MailResponseException(400, [
                'error' => 'smtp_connect',
                'message' => $message !== ''
                    ? $message.' (configured: '.$endpoint.')'
                    : 'Could not connect to SMTP server at '.$endpoint.'.',
                'smtp' => [
                    'host' => $transport['host'],
                    'port' => $transport['port'],
                    'security' => $transport['security'],
                ],
            ]);
        }

        return new MailResponseException(400, [
            'error' => 'send_failed',
            'message' => $message !== '' ? $message : 'SMTP send failed.',
        ]);
    }
}
