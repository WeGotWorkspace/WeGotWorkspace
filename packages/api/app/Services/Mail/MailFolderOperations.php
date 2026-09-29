<?php

declare(strict_types=1);

namespace App\Services\Mail;

use IMAP\Connection;

final class MailFolderOperations
{
    public function __construct(
        private MailImapGate $imap,
    ) {}

    public function handleFolders(string $username): array
    {
        $cred = $this->imap->requireImap($username);
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
            $id = MailOperationService::folderIdEncode($mb);
            $del = self::normalizeMailboxDelimiter($row['delimiter']);
            $pCanon = self::resolveParentByLongestListedPrefix($mb, $raw);
            if ($pCanon === null) {
                $pCanon = self::resolveParentMailboxForTree($mb, $del, $byLower);
            }
            $parentId = $pCanon !== null ? MailOperationService::folderIdEncode($pCanon) : null;
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
            $mb = MailOperationService::folderIdDecode($id);
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
        $del = self::normalizeMailboxDelimiter($row['delimiter']);
        $leaf = self::mailboxLeafSegment($mb, $del);

        return MailImapClient::decodeMailboxName($leaf);
    }

    private function normalizeMailboxDelimiter(string $delimiter): string
    {
        if (strlen($delimiter) === 1) {
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
            if ($k === '') {
                continue;
            }
            $lk = strlen($k);
            if ($lk >= $mLen) {
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
            if ($mb === '') {
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
                $d = $row['delimiter'];

                return strlen($d) === 1 ? $d : '.';
            }
        }
        foreach ($raw as $row) {
            if (strtoupper($row['mailbox']) === 'INBOX') {
                $d = $row['delimiter'];

                return strlen($d) === 1 ? $d : '.';
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

    public function resolveSystemMailbox(Connection $conn, string $ref, string $sys): ?string
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
    public function tryAppendRfc822ToSystemFolder(
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
    public function tryAppendSentCopy(array $cred, string $rfc822, ?string &$outErr): void
    {
        self::tryAppendRfc822ToSystemFolder($cred, $rfc822, 'sent', '\\Seen', $outErr);
    }

    public function handleFolderCreate(string $username, array $j): array
    {

        $name = trim((string) ($j['name'] ?? ''));
        if ($name === '') {
            throw new MailResponseException(400, ['error' => 'name_required']);
        }
        $cred = $this->imap->requireImap($username);
        $parentEnc = isset($j['parentMailbox']) && is_string($j['parentMailbox']) ? $j['parentMailbox'] : '';
        $parent = $parentEnc !== '' ? MailOperationService::folderIdDecode($parentEnc) : '';
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
                $resp = [200, ['ok' => true, 'mailbox' => $full, 'id' => MailOperationService::folderIdEncode($full)]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    public function handleFolderMove(string $username, array $j): array
    {

        $folderEnc = isset($j['folder']) && is_string($j['folder']) ? $j['folder'] : '';
        $fromMb = MailOperationService::folderIdDecode($folderEnc);
        if ($fromMb === '' || strtoupper($fromMb) === 'INBOX' || $fromMb === '__starred__') {
            throw new MailResponseException(400, ['error' => 'cannot_move']);
        }
        $cred = $this->imap->requireImap($username);
        $parentEnc = isset($j['parentMailbox']) && is_string($j['parentMailbox']) ? $j['parentMailbox'] : '';
        $parent = $parentEnc !== '' ? MailOperationService::folderIdDecode($parentEnc) : '';
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
                return ['ok' => true, 'id' => MailOperationService::folderIdEncode($fromMb)];
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
                $resp = [200, ['ok' => true, 'mailbox' => $newMb, 'id' => MailOperationService::folderIdEncode($newMb)]];
            }
        } finally {
            @imap_close($conn);
        }
        if ($resp[0] !== 200) {
            throw new MailResponseException($resp[0], $resp[1]);
        }

        return $resp[1];
    }

    public function handleFolderDelete(string $username, array $j): array
    {
        $enc = (string) ($j['folder'] ?? '');
        $mb = MailOperationService::folderIdDecode($enc);
        if ($mb === '' || strtoupper($mb) === 'INBOX' || $mb === '__starred__') {
            throw new MailResponseException(400, ['error' => 'cannot_delete']);
        }
        $cred = $this->imap->requireImap($username);
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
}
