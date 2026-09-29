<?php

declare(strict_types=1);

namespace App\Services\Mail;

use IMAP\Connection;

trait MailMessageOperations
{
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

}
