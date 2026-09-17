<?php

declare(strict_types=1);

namespace App\Services\Mail;

use IMAP\Connection;
use ZBateson\MailMimeParser\MailMimeParser;

/**
 * Thin IMAP wrapper (requires PHP {@code ext-imap}).
 */
final class MailImapClient
{
    /**
     * @param  array{host: string, port: int, security: string, username: string, password: string}  $imapCred
     */
    public static function mailboxRef(array $imapCred): string
    {
        $sec = $imapCred['security'] ?? 'ssl';
        $flag = match ($sec) {
            'starttls' => '/tls',
            'none' => '/notls',
            default => '/ssl',
        };

        return '{'.$imapCred['host'].':'.(int) $imapCred['port'].'/imap'.$flag.'}';
    }

    /**
     * @param  array{host: string, port: int, security: string, username: string, password: string}  $imapCred
     */
    public static function connect(array $imapCred, ?string &$error): ?Connection
    {
        if (! function_exists('imap_open')) {
            $error = 'PHP imap extension (ext-imap) is not loaded.';

            return null;
        }
        $ref = self::mailboxRef($imapCred);
        imap_timeout(\IMAP_OPENTIMEOUT, 15);
        $error = null;
        $conn = @imap_open($ref.'INBOX', $imapCred['username'], $imapCred['password'], 0, 1);
        if ($conn === false) {
            $error = imap_last_error() ?: 'imap_open failed';

            return null;
        }
        imap_timeout(\IMAP_READTIMEOUT, 30);
        imap_timeout(\IMAP_WRITETIMEOUT, 30);
        imap_timeout(\IMAP_CLOSETIMEOUT, 5);

        return $conn;
    }

    /**
     * @return list<array{name: string, mailbox: string, delimiter: string, noSelect?: bool}>
     */
    public static function listMailboxes(Connection $conn, string $ref): array
    {
        if (function_exists('imap_getmailboxes')) {
            $boxes = @imap_getmailboxes($conn, $ref, '*');
            if (is_array($boxes) && $boxes !== []) {
                $out = [];
                foreach ($boxes as $box) {
                    if (! is_object($box)) {
                        continue;
                    }
                    $full = $box->name ?? null;
                    if (! is_string($full) || $full === '') {
                        continue;
                    }
                    $mb = self::stripRef($full, $ref);
                    if ($mb === '') {
                        continue;
                    }
                    $del = $box->delimiter ?? '.';
                    if (is_int($del) && $del > 0 && $del < 256) {
                        $delimiter = chr($del);
                    } elseif (is_string($del) && $del !== '') {
                        $delimiter = $del;
                    } else {
                        $delimiter = '.';
                    }
                    $name = self::decodeMailboxName($mb);
                    $attrs = (int) ($box->attributes ?? 0);
                    $noSelect = \defined('LATT_NOSELECT') && ($attrs & \LATT_NOSELECT) !== 0;
                    $row = ['name' => $name, 'mailbox' => $mb, 'delimiter' => $delimiter];
                    if ($noSelect) {
                        $row['noSelect'] = true;
                    }
                    $out[] = $row;
                }
                if ($out !== []) {
                    usort($out, static fn ($a, $b) => strcasecmp($a['mailbox'], $b['mailbox']));

                    return $out;
                }
            }
        }

        $raw = @imap_list($conn, $ref, '*');
        if ($raw === false) {
            return [];
        }
        $out = [];
        foreach ($raw as $full) {
            if (! is_string($full)) {
                continue;
            }
            $mb = self::stripRef($full, $ref);
            if ($mb === '') {
                continue;
            }
            $name = self::decodeMailboxName($mb);
            $out[] = ['name' => $name, 'mailbox' => $mb, 'delimiter' => '.'];
        }
        if ($out !== []) {
            $slash = 0;
            $dot = 0;
            foreach ($out as $row) {
                $slash += substr_count($row['mailbox'], '/');
                $dot += substr_count($row['mailbox'], '.');
            }
            $guess = $slash > $dot ? '/' : '.';
            foreach ($out as $i => $_) {
                $out[$i]['delimiter'] = $guess;
            }
        }
        usort($out, static fn ($a, $b) => strcasecmp($a['mailbox'], $b['mailbox']));

        return $out;
    }

    public static function stripRef(string $full, string $ref): string
    {
        if (str_starts_with($full, $ref)) {
            return substr($full, strlen($ref));
        }
        if (preg_match('#^\{[^}]+\}(.+)$#', $full, $m) === 1) {
            return $m[1];
        }

        return $full;
    }

    public static function decodeMailboxName(string $mb): string
    {
        if (function_exists('imap_utf7_decode')) {
            $d = @imap_utf7_decode($mb);

            return is_string($d) && $d !== '' ? $d : $mb;
        }

        return $mb;
    }

    /**
     * Newest-first UIDs for one page. {@code $totalCap} bounds memory after {@code imap_sort}.
     *
     * @return array{uids: list<int>, hasMore: bool}
     */
    public static function sortUidsNewestFirstPaged(
        Connection $conn,
        string $ref,
        string $mailbox,
        int $limit,
        int $offset,
        int $totalCap = 1000,
    ): array {
        if (! @imap_reopen($conn, $ref.$mailbox)) {
            return ['uids' => [], 'hasMore' => false];
        }
        // PHP 8+: fourth arg is flags bitmask; use \SE_UID for UIDs (SORT_UID no longer exists).
        $uids = imap_sort($conn, \SORTDATE, true, \SE_UID);
        if ($uids === false) {
            return ['uids' => [], 'hasMore' => false];
        }
        $uids = array_map('intval', $uids);
        rsort($uids, \SORT_NUMERIC);
        $cap = max(1, $totalCap);
        $capped = array_slice($uids, 0, $cap);
        $n = count($capped);
        $off = max(0, $offset);
        $lim = max(1, $limit);
        $page = array_slice($capped, $off, $lim);
        $hasMore = $off + count($page) < $n;

        return ['uids' => $page, 'hasMore' => $hasMore];
    }

    /**
     * Escape a value for use inside an IMAP SEARCH quoted string.
     */
    public static function searchCriterionEscapeQuoted(string $q): string
    {
        return str_replace(['\\', '"'], ['\\\\', '\\"'], $q);
    }

    /**
     * SEARCH with arbitrary AND criteria (e.g. {@code TEXT "…"}, {@code UNSEEN TEXT "…"}, {@code FLAGGED TEXT "…"}),
     * then newest-first paging like {@see sortUidsNewestFirstPaged}.
     *
     * @return array{uids: list<int>, hasMore: bool}
     */
    public static function searchUidsNewestFirstPaged(
        Connection $conn,
        string $ref,
        string $mailbox,
        string $imapAndCriteria,
        int $limit,
        int $offset,
        int $totalCap = 2000,
    ): array {
        if (! @imap_reopen($conn, $ref.$mailbox)) {
            return ['uids' => [], 'hasMore' => false];
        }
        $uids = false;
        if (\PHP_VERSION_ID >= 80100) {
            $charset = null;
            if (extension_loaded('mbstring') && ! mb_check_encoding($imapAndCriteria, 'ASCII')) {
                $charset = 'UTF-8';
            }
            $uids = $charset !== null
                ? @imap_search($conn, $imapAndCriteria, \SE_UID, $charset)
                : @imap_search($conn, $imapAndCriteria, \SE_UID);
        } else {
            $uids = @imap_search($conn, $imapAndCriteria, \SE_UID);
        }
        if ($uids === false) {
            return ['uids' => [], 'hasMore' => false];
        }
        $uids = array_map('intval', $uids);
        $uids = array_values(array_unique($uids));
        rsort($uids, \SORT_NUMERIC);
        $cap = max(1, $totalCap);
        $capped = array_slice($uids, 0, $cap);
        $n = count($capped);
        $off = max(0, $offset);
        $lim = max(1, $limit);
        $page = array_slice($capped, $off, $lim);
        $hasMore = $off + count($page) < $n;

        return ['uids' => $page, 'hasMore' => $hasMore];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function fetchOverviews(Connection $conn, array $uids): array
    {
        if ($uids === []) {
            return [];
        }
        $seq = implode(',', array_map('strval', $uids));
        $ov = imap_fetch_overview($conn, $seq, \FT_UID);
        if ($ov === false) {
            return [];
        }

        return array_values($ov);
    }

    public static function msgnoFromUid(Connection $conn, int $uid): int
    {
        $n = imap_msgno($conn, $uid);

        return $n > 0 ? $n : 0;
    }

    /**
     * Lightweight attachment list from {@code imap_fetchstructure} (no body fetch). Used for mailbox rows.
     *
     * @return list<array{id: string, name: string, size: int, type: string, part: string}>
     */
    public static function attachmentSummariesFromStructure(object $st): array
    {
        $seq = 0;
        $out = [];

        self::collectAttachmentSummaries($st, $seq, $out, '');

        return $out;
    }

    /**
     * @param  list<array{id: string, name: string, size: int, type: string, part: string}>  $out
     */
    private static function collectAttachmentSummaries(object $st, int &$seq, array &$out, string $prefix): void
    {
        $type = (int) ($st->type ?? 0);
        $sub = isset($st->subtype) ? strtolower((string) $st->subtype) : '';
        if ($type === 2 && $sub === 'rfc822') {
            $seq++;
            $num = $prefix !== '' ? $prefix : '1';
            $fn = self::filenameFromStructurePart($st);
            $label = $fn !== null && $fn !== '' ? $fn : 'Forwarded message.eml';
            $out[] = [
                'id' => 'a'.$seq,
                'name' => self::decodeMimeHeaderLine($label),
                'size' => (int) ($st->bytes ?? 0),
                'type' => 'message/rfc822',
                'part' => $num,
            ];

            return;
        }
        if (! empty($st->parts) && is_array($st->parts)) {
            foreach ($st->parts as $i => $p) {
                if (is_object($p)) {
                    $child = $prefix === '' ? (string) ($i + 1) : $prefix.'.'.($i + 1);
                    self::collectAttachmentSummaries($p, $seq, $out, $child);
                }
            }

            return;
        }
        if ($type === 1) {
            return;
        }
        if (! self::isAttachmentLikeLeaf($st)) {
            return;
        }
        $seq++;
        $fn = self::filenameFromStructurePart($st) ?? 'attachment';
        $num = $prefix !== '' ? $prefix : '1';
        $out[] = [
            'id' => 'a'.$seq,
            'name' => self::decodeMimeHeaderLine($fn),
            'size' => (int) ($st->bytes ?? 0),
            'type' => self::mimeFromPartStructure($st),
            'part' => $num,
        ];
    }

    /**
     * Fetch one MIME section by part number (e.g. {@code "2"}, {@code "1.3"}) and decode transfer encoding.
     *
     * @return array{bytes: string, mime: string}|null
     */
    public static function fetchDecodedMimePart(Connection $conn, int $msgno, string $partNum): ?array
    {
        if ($msgno <= 0 || $partNum === '') {
            return null;
        }
        $bs = @imap_bodystruct($conn, $msgno, $partNum);
        $enc = 0;
        if (is_object($bs)) {
            $enc = (int) ($bs->encoding ?? 0);
        }
        $raw = @imap_fetchbody($conn, $msgno, $partNum, \FT_PEEK);
        if (! is_string($raw)) {
            return null;
        }
        $decoded = self::decodeTransfer($raw, $enc);
        $mime = is_object($bs) ? self::mimeFromPartStructure($bs) : 'application/octet-stream';

        return ['bytes' => $decoded, 'mime' => $mime];
    }

    private static function isAttachmentLikeLeaf(object $st): bool
    {
        if (! empty($st->ifdisposition) && isset($st->disposition)) {
            return strtolower(trim((string) $st->disposition)) === 'attachment';
        }
        $type = (int) ($st->type ?? 0);
        $sub = isset($st->subtype) ? strtolower((string) $st->subtype) : '';
        if ($type === 0 && ($sub === 'plain' || $sub === 'html' || $sub === 'calendar')) {
            return false;
        }
        $fn = self::filenameFromStructurePart($st);
        if ($fn === null || trim($fn) === '') {
            return false;
        }

        return $type !== 0;
    }

    private static function filenameFromStructurePart(object $st): ?string
    {
        foreach (['dparameters', 'parameters'] as $prop) {
            if (empty($st->{$prop}) || ! is_array($st->{$prop})) {
                continue;
            }
            foreach ($st->{$prop} as $x) {
                if (! is_object($x)) {
                    continue;
                }
                $a = isset($x->attribute) ? strtolower((string) $x->attribute) : '';
                if (($a === 'filename' || $a === 'name') && isset($x->value) && is_string($x->value)) {
                    $v = trim($x->value);
                    if ($v !== '') {
                        return $v;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Decode RFC 2047 encoded-words in one header field value (after unfolding).
     */
    public static function decodeMimeHeaderLine(string $s): string
    {
        if (function_exists('iconv_mime_decode')) {
            $d = @iconv_mime_decode($s, \ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');

            return is_string($d) ? $d : $s;
        }

        return $s;
    }

    /**
     * Extract one or more header bodies (RFC 5322 folding: lines beginning with WSP continue the previous field).
     *
     * @param  list<string>  $wantLower  lower-case names, e.g. {@code ['to','cc']}
     * @return array<string, string> lower-case name → unfolded body (comma-separated if duplicate field names)
     */
    public static function extractHeaderFieldBodies(string $raw, array $wantLower): array
    {
        $want = [];
        foreach ($wantLower as $n) {
            $want[strtolower($n)] = true;
        }
        $out = [];
        $norm = str_replace(["\r\n", "\r"], "\n", $raw);
        $lines = explode("\n", $norm);
        $current = null;
        foreach ($lines as $line) {
            if ($line === '') {
                break;
            }
            if ($current !== null && ($line[0] === ' ' || $line[0] === "\t")) {
                $out[$current] = ($out[$current] ?? '').' '.ltrim($line);

                continue;
            }
            $current = null;
            if (preg_match('/^([^:\x00-\x1f]+):\s*(.*)$/', $line, $m) !== 1) {
                continue;
            }
            $name = strtolower(trim($m[1]));
            if (! isset($want[$name])) {
                continue;
            }
            $current = $name;
            $prev = $out[$name] ?? '';
            $sep = $prev !== '' ? ', ' : '';
            $out[$name] = $prev.$sep.$m[2];
        }

        return $out;
    }

    /**
     * Full {@code To}/{@code Cc} from raw message headers. Prefer this over {@code imap_headerinfo()} arrays,
     * which are often truncated to a single address by the IMAP c-client.
     *
     * @return array{to: list<array{name?: string, email: string}>, cc: list<array{name?: string, email: string}>}
     */
    public static function parseToCcFromFetchHeader(Connection $conn, int $msgno): array
    {
        if ($msgno <= 0) {
            return ['to' => [], 'cc' => []];
        }
        $raw = @imap_fetchheader($conn, $msgno);
        if (! is_string($raw) || trim($raw) === '') {
            return ['to' => [], 'cc' => []];
        }
        $bodies = self::extractHeaderFieldBodies($raw, ['to', 'cc']);
        $toRaw = trim($bodies['to'] ?? '');
        $ccRaw = trim($bodies['cc'] ?? '');

        return [
            'to' => $toRaw !== '' ? self::parseAddressListHeader(self::decodeMimeHeaderLine($toRaw)) : [],
            'cc' => $ccRaw !== '' ? self::parseAddressListHeader(self::decodeMimeHeaderLine($ccRaw)) : [],
        ];
    }

    /**
     * Plain-text body for quoting and simple clients.
     */
    public static function fetchPlainBody(Connection $conn, int $msgno): string
    {
        return self::fetchMessageContent($conn, $msgno)['plain'];
    }

    /**
     * @return array{plain: string, html: string} {@code plain} is always suitable for reply/forward; {@code html} may be empty.
     */
    public static function fetchMessageContent(Connection $conn, int $msgno): array
    {
        if ($msgno <= 0) {
            return ['plain' => '', 'html' => ''];
        }
        $parsed = self::fetchMessageContentWithMimeParser($conn, $msgno);
        if ($parsed === null) {
            return ['plain' => '', 'html' => ''];
        }

        return $parsed;
    }

    /**
     * Parse full RFC822 source with a dedicated MIME parser (industry-standard charset and transfer handling).
     *
     * @return array{plain: string, html: string}|null
     */
    private static function fetchMessageContentWithMimeParser(Connection $conn, int $msgno): ?array
    {
        if (! class_exists(MailMimeParser::class)) {
            return null;
        }
        $raw = self::fetchRawMessageSource($conn, $msgno);
        if ($raw === null) {
            return null;
        }
        try {
            $parser = new MailMimeParser;
            $message = $parser->parse($raw, false);
            $plain = trim((string) ($message->getTextContent() ?? ''));
            $html = trim((string) ($message->getHtmlContent() ?? ''));
            if ($plain === '' && $html !== '') {
                $plain = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }
            if ($plain === '' && $html === '') {
                return null;
            }

            return ['plain' => $plain, 'html' => $html];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Build the raw message source (headers + body) for MIME parsing.
     */
    private static function fetchRawMessageSource(Connection $conn, int $msgno): ?string
    {
        $header = @imap_fetchheader($conn, $msgno);
        $body = @imap_body($conn, $msgno, \FT_PEEK);
        if (! is_string($header) || $header === '' || ! is_string($body)) {
            return null;
        }

        return rtrim($header, "\r\n")."\r\n\r\n".$body;
    }

    /**
     * @return array{plain: string, html: string}
     */
    private static function extractBodiesFromStructure(Connection $conn, int $msgno, object $st, string $prefix): array
    {
        if (! empty($st->parts)) {
            $subtype = isset($st->subtype) ? strtolower((string) $st->subtype) : '';
            if ($subtype === 'alternative') {
                $plain = '';
                $html = '';
                foreach ($st->parts as $i => $p) {
                    if (! is_object($p)) {
                        continue;
                    }
                    $num = $prefix === '' ? (string) ($i + 1) : $prefix.'.'.($i + 1);
                    $r = self::extractBodiesFromStructure($conn, $msgno, $p, $num);
                    if ($r['plain'] !== '') {
                        $plain = $r['plain'];
                    }
                    if ($r['html'] !== '') {
                        $html = $r['html'];
                    }
                }

                return ['plain' => $plain, 'html' => $html];
            }
            if ($subtype === 'related') {
                $html = '';
                $plainFromText = '';
                $calendarPlain = '';
                foreach ($st->parts as $i => $p) {
                    if (! is_object($p)) {
                        continue;
                    }
                    $num = $prefix === '' ? (string) ($i + 1) : $prefix.'.'.($i + 1);
                    $psub = isset($p->subtype) ? strtolower((string) $p->subtype) : '';
                    $r = self::extractBodiesFromStructure($conn, $msgno, $p, $num);
                    if ($r['html'] !== '') {
                        $html = $r['html'];
                    }
                    if ($psub === 'calendar') {
                        if ($r['plain'] !== '') {
                            $calendarPlain = $r['plain'];
                        }

                        continue;
                    }
                    if ($r['plain'] !== '') {
                        $plainFromText = $r['plain'];
                    }
                }
                if ($html !== '') {
                    return ['plain' => $plainFromText, 'html' => $html];
                }

                return [
                    'plain' => $plainFromText !== '' ? $plainFromText : $calendarPlain,
                    'html' => '',
                ];
            }
            foreach ($st->parts as $i => $p) {
                if (! is_object($p)) {
                    continue;
                }
                $num = $prefix === '' ? (string) ($i + 1) : $prefix.'.'.($i + 1);
                $r = self::extractBodiesFromStructure($conn, $msgno, $p, $num);
                if ($r['plain'] !== '' || $r['html'] !== '') {
                    return $r;
                }
            }

            return ['plain' => '', 'html' => ''];
        }
        $type = (int) ($st->type ?? 0);
        $sub = isset($st->subtype) ? strtolower((string) $st->subtype) : '';
        if ($type !== 0) {
            return ['plain' => '', 'html' => ''];
        }
        $num = $prefix === '' ? '1' : $prefix;
        $raw = imap_fetchbody($conn, $msgno, $num, \FT_PEEK);
        if (! is_string($raw)) {
            return ['plain' => '', 'html' => ''];
        }
        $decoded = self::decodeTransfer($raw, (int) ($st->encoding ?? 0));
        if ($sub === 'plain') {
            return ['plain' => $decoded, 'html' => ''];
        }
        if ($sub === 'html') {
            return ['plain' => '', 'html' => $decoded];
        }
        if ($sub === 'calendar') {
            return ['plain' => $decoded, 'html' => ''];
        }

        return ['plain' => '', 'html' => ''];
    }

    private static function decodeTransfer(string $raw, int $encoding): string
    {
        return match ($encoding) {
            3 => base64_decode($raw, true) !== false ? (string) base64_decode($raw, true) : $raw,
            4 => quoted_printable_decode($raw),
            default => $raw,
        };
    }

    /**
     * Inline MIME parts use {@code Content-ID}; HTML references them as {@code cid:…} (RFC 2392).
     * Browsers cannot resolve {@code cid:} inside {@code srcDoc}, so replace known CIDs with {@code data:} URLs.
     */
    public static function rewriteHtmlCidReferences(Connection $conn, int $msgno, string $html): string
    {
        if ($msgno <= 0 || $html === '' || stripos($html, 'cid:') === false) {
            return $html;
        }
        $st = imap_fetchstructure($conn, $msgno);
        if ($st === false) {
            return $html;
        }
        /** @var array<string, string> $map */
        $map = self::collectCidDataUrlMap($conn, $msgno, $st, '');

        return $map === [] ? $html : self::replaceCidUrlsInHtml($html, $map);
    }

    /**
     * @return array<string, string> normalized Content-ID → data URL
     */
    private static function collectCidDataUrlMap(Connection $conn, int $msgno, object $st, string $prefix): array
    {
        if (! empty($st->parts)) {
            $map = [];
            foreach ($st->parts as $i => $p) {
                if (! is_object($p)) {
                    continue;
                }
                $num = $prefix === '' ? (string) ($i + 1) : $prefix.'.'.($i + 1);
                foreach (self::collectCidDataUrlMap($conn, $msgno, $p, $num) as $k => $v) {
                    $map[$k] = $v;
                }
            }

            return $map;
        }
        $partNum = $prefix === '' ? '1' : $prefix;
        $candidates = self::contentIdCandidatesFromPart($st);
        if ($candidates === [] && function_exists('imap_bodystruct')) {
            $bs = @imap_bodystruct($conn, $msgno, $partNum);
            if (is_object($bs)) {
                $candidates = self::contentIdCandidatesFromPart($bs);
            }
        }
        if ($candidates === []) {
            return [];
        }
        $normKeys = [];
        foreach ($candidates as $c) {
            $k = self::normalizeCidKey($c);
            if ($k !== '') {
                $normKeys[$k] = true;
            }
        }
        if ($normKeys === []) {
            return [];
        }
        $raw = imap_fetchbody($conn, $msgno, $partNum, \FT_PEEK);
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $decoded = self::decodeTransfer($raw, (int) ($st->encoding ?? 0));
        $maxPart = 512 * 1024;
        if (strlen($decoded) > $maxPart) {
            return [];
        }
        $mime = self::mimeFromPartStructure($st);
        $b64 = base64_encode($decoded);
        if ($b64 === false) {
            return [];
        }
        $dataUrl = 'data:'.$mime.';base64,'.$b64;
        $map = [];
        foreach (array_keys($normKeys) as $k) {
            $map[$k] = $dataUrl;
        }

        return $map;
    }

    /**
     * Some IMAP stacks omit {@code ->id} or duplicate Content-ID in MIME parameters; collect every candidate.
     *
     * @return list<string>
     */
    private static function contentIdCandidatesFromPart(object $st): array
    {
        $out = [];
        if (! empty($st->id) && is_string($st->id)) {
            $t = trim($st->id);
            if ($t !== '') {
                $out[] = $t;
            }
        }
        foreach (['parameters', 'dparameters'] as $prop) {
            if (empty($st->{$prop}) || ! is_array($st->{$prop})) {
                continue;
            }
            foreach ($st->{$prop} as $x) {
                if (! is_object($x)) {
                    continue;
                }
                $a = isset($x->attribute) ? strtolower((string) $x->attribute) : '';
                if (($a === 'id' || $a === 'content-id') && isset($x->value) && is_string($x->value)) {
                    $t = trim($x->value);
                    if ($t !== '') {
                        $out[] = $t;
                    }
                }
            }
        }
        $uniq = [];
        foreach ($out as $c) {
            $uniq[strtolower($c)] = $c;
        }

        return array_values($uniq);
    }

    /**
     * Map HTML {@code cid:…} to a data URL; supports short refs ({@code cid:img1}) vs full Content-IDs ({@code <img1@host>}).
     */
    private static function resolveCidToDataUrl(string $cidUri, array $cidToDataUrl): ?string
    {
        if (! preg_match('/^cid:(.+)$/is', $cidUri, $m)) {
            return null;
        }
        $key = self::normalizeCidKey($m[1]);
        if ($key === '') {
            return null;
        }
        if (isset($cidToDataUrl[$key])) {
            return $cidToDataUrl[$key];
        }
        foreach ($cidToDataUrl as $mimeKey => $url) {
            if (str_starts_with($mimeKey, $key.'@')) {
                return $url;
            }
        }
        if (! str_contains($key, '@')) {
            foreach ($cidToDataUrl as $mimeKey => $url) {
                $at = strpos($mimeKey, '@');
                if ($at !== false && $at > 0) {
                    $local = substr($mimeKey, 0, $at);
                    if ($local === $key) {
                        return $url;
                    }
                }
            }
        }

        return null;
    }

    private static function normalizeCidKey(string $id): string
    {
        $id = trim(rawurldecode($id));
        if ($id !== '' && str_starts_with($id, '<') && str_ends_with($id, '>')) {
            $id = substr($id, 1, -1);
        }

        return strtolower(trim($id));
    }

    private static function mimeFromPartStructure(object $st): string
    {
        $type = (int) ($st->type ?? 0);
        $sub = isset($st->subtype) ? strtolower((string) $st->subtype) : '';

        return match ($type) {
            0 => $sub !== '' ? 'text/'.$sub : 'text/plain',
            3 => $sub !== '' ? 'application/'.$sub : 'application/octet-stream',
            4 => $sub !== '' ? 'audio/'.$sub : 'audio/mpeg',
            5 => $sub !== '' ? 'image/'.$sub : 'image/jpeg',
            6 => $sub !== '' ? 'video/'.$sub : 'video/mp4',
            default => $sub !== '' ? 'application/'.$sub : 'application/octet-stream',
        };
    }

    /**
     * @param  array<string, string>  $cidToDataUrl
     */
    private static function replaceCidUrlsInHtml(string $html, array $cidToDataUrl): string
    {
        $replace = static function (string $cidFull) use ($cidToDataUrl): ?string {
            return self::resolveCidToDataUrl($cidFull, $cidToDataUrl);
        };

        $html = preg_replace_callback(
            '/\bsrc\s*=\s*(")(cid:[^"]+)\1/iu',
            static function (array $m) use ($replace): string {
                $data = $replace($m[2]);

                return $data !== null ? 'src='.$m[1].$data.$m[1] : $m[0];
            },
            $html
        ) ?? $html;

        $html = preg_replace_callback(
            '/\bsrc\s*=\s*(\')(cid:[^\']+)\1/iu',
            static function (array $m) use ($replace): string {
                $data = $replace($m[2]);

                return $data !== null ? 'src='.$m[1].$data.$m[1] : $m[0];
            },
            $html
        ) ?? $html;

        $html = preg_replace_callback(
            '/\bsrc\s*=\s*(cid:[^\s>]+)/iu',
            static function (array $m) use ($replace): string {
                $data = $replace($m[1]);

                return $data !== null ? 'src='.$data : $m[0];
            },
            $html
        ) ?? $html;

        return preg_replace_callback(
            '/url\(\s*(["\']?)\s*(cid:[^"\')\s]+)\s*\1\s*\)/iu',
            static function (array $m) use ($replace): string {
                $data = $replace($m[2]);

                return $data !== null ? 'url('.$m[1].$data.$m[1].')' : $m[0];
            },
            $html
        ) ?? $html;
    }

    /**
     * @return array{uids: list<int>, hasMore: bool}
     */
    public static function searchFlaggedUidsPaged(
        Connection $conn,
        string $ref,
        string $inboxMailbox,
        int $limit,
        int $offset,
        int $totalCap = 500,
    ): array {
        if (! @imap_reopen($conn, $ref.$inboxMailbox)) {
            return ['uids' => [], 'hasMore' => false];
        }
        $uids = imap_search($conn, 'FLAGGED', \SE_UID);
        if ($uids === false) {
            return ['uids' => [], 'hasMore' => false];
        }
        $uids = array_map('intval', $uids);
        rsort($uids, \SORT_NUMERIC);
        $cap = max(1, $totalCap);
        $capped = array_slice($uids, 0, $cap);
        $n = count($capped);
        $off = max(0, $offset);
        $lim = max(1, $limit);
        $page = array_slice($capped, $off, $lim);
        $hasMore = $off + count($page) < $n;

        return ['uids' => $page, 'hasMore' => $hasMore];
    }

    public static function setFlags(Connection $conn, int $uid, bool $seen, bool $flagged): void
    {
        $seq = (string) $uid;
        if ($seen) {
            @imap_setflag_full($conn, $seq, '\\Seen', \ST_UID);
        } else {
            @imap_clearflag_full($conn, $seq, '\\Seen', \ST_UID);
        }
        if ($flagged) {
            @imap_setflag_full($conn, $seq, '\\Flagged', \ST_UID);
        } else {
            @imap_clearflag_full($conn, $seq, '\\Flagged', \ST_UID);
        }
    }

    public static function deleteUid(Connection $conn, int $uid): bool
    {
        return @imap_delete($conn, (string) $uid, \FT_UID) && @imap_expunge($conn);
    }

    public static function moveUid(Connection $conn, string $ref, int $uid, string $targetMailbox): bool
    {
        // imap_mail_move expects a mailbox name (not the full "{host}…" ref).
        // For non-ASCII mailbox names, use modified UTF-7 if available.
        $mb = $targetMailbox;
        if (function_exists('imap_utf7_encode')) {
            $enc = @imap_utf7_encode($targetMailbox);
            if (is_string($enc) && $enc !== '') {
                $mb = $enc;
            }
        }

        return imap_mail_move($conn, (string) $uid, $mb, \CP_UID) && imap_expunge($conn);
    }

    public static function reopenMailbox(Connection $conn, string $ref, string $mailbox): bool
    {
        return @imap_reopen($conn, $ref.$mailbox);
    }

    /**
     * IMAP {@code STATUS} (UNSEEN) for one mailbox path — RFC 3501 counts only messages in that mailbox,
     * not inferiors (subfolders are separate namespaces).
     */
    public static function statusUnseen(Connection $conn, string $ref, string $mailbox): int
    {
        if (! function_exists('imap_status')) {
            return 0;
        }
        $st = @imap_status($conn, $ref.$mailbox, \SA_UNSEEN);
        if ($st === false || ! isset($st->unseen)) {
            return 0;
        }

        return max(0, (int) $st->unseen);
    }

    /**
     * IMAP STATUS for UIDVALIDITY / UIDNEXT / UNSEEN / MESSAGES.
     *
     * @return array{unseen: int, messages: int, uidnext: int, uidvalidity: int}|null
     */
    public static function mailboxStatus(Connection $conn, string $ref, string $mailbox): ?array
    {
        if (! function_exists('imap_status')) {
            return null;
        }
        $st = @imap_status($conn, $ref.$mailbox, \SA_UNSEEN | \SA_MESSAGES | \SA_UIDNEXT | \SA_UIDVALIDITY);
        if ($st === false) {
            return null;
        }

        return [
            'unseen' => max(0, (int) ($st->unseen ?? 0)),
            'messages' => max(0, (int) ($st->messages ?? 0)),
            'uidnext' => max(0, (int) ($st->uidnext ?? 0)),
            'uidvalidity' => max(0, (int) ($st->uidvalidity ?? 0)),
        ];
    }

    public static function appendRfc822(Connection $conn, string $ref, string $mailbox, string $rfc822, string $flags = ''): bool
    {
        if (! function_exists('imap_append')) {
            return false;
        }

        return $flags !== ''
            ? @imap_append($conn, $ref.$mailbox, $rfc822, $flags)
            : @imap_append($conn, $ref.$mailbox, $rfc822);
    }

    public static function createMailbox(Connection $conn, string $ref, string $fullUtf8Path): bool
    {
        $enc = function_exists('imap_utf7_encode') ? @imap_utf7_encode($fullUtf8Path) : $fullUtf8Path;
        if (! is_string($enc) || $enc === '') {
            $enc = $fullUtf8Path;
        }

        return @imap_createmailbox($conn, $ref.$enc);
    }

    public static function deleteMailbox(Connection $conn, string $ref, string $mailbox): bool
    {
        return @imap_deletemailbox($conn, $ref.$mailbox);
    }

    /**
     * IMAP RENAME — move/reparent a mailbox (UTF-8 logical paths; encoded like {@see createMailbox}).
     */
    public static function renameMailbox(Connection $conn, string $ref, string $oldUtf8Path, string $newUtf8Path): bool
    {
        $oldEnc = function_exists('imap_utf7_encode') ? @imap_utf7_encode($oldUtf8Path) : $oldUtf8Path;
        if (! is_string($oldEnc) || $oldEnc === '') {
            $oldEnc = $oldUtf8Path;
        }
        $newEnc = function_exists('imap_utf7_encode') ? @imap_utf7_encode($newUtf8Path) : $newUtf8Path;
        if (! is_string($newEnc) || $newEnc === '') {
            $newEnc = $newUtf8Path;
        }

        return @imap_renamemailbox($conn, $ref.$oldEnc, $ref.$newEnc);
    }

    /**
     * @return array{name: string, email: string}
     */
    public static function parseFrom(string $fromHeader): array
    {
        $fromHeader = trim($fromHeader);
        if (preg_match('/^(?:"([^"]*)"|([^<]+?))\s*<([^>]+)>$/u', $fromHeader, $m)) {
            $name = trim($m[1] !== '' ? $m[1] : ($m[2] ?? ''), " \t\"'");
            $email = trim($m[3]);

            return ['name' => $name !== '' ? self::decodeMime($name) : $email, 'email' => $email];
        }
        if (preg_match('/<([^>]+)>/', $fromHeader, $m)) {
            return ['name' => trim(str_replace($m[0], '', $fromHeader)), 'email' => trim($m[1])];
        }
        if (str_contains($fromHeader, '@')) {
            return ['name' => $fromHeader, 'email' => $fromHeader];
        }

        return ['name' => 'Unknown', 'email' => ''];
    }

    /**
     * One address from {@code imap_rfc822_parse_adrlist()} or {@code imap_headerinfo()} {@code to}/{@code cc} elements.
     *
     * @return array{name?: string, email: string}|null
     */
    public static function addressObjectToRow(object $ent): ?array
    {
        $host = isset($ent->host) ? (string) $ent->host : '';
        if ($host === '.SYNTAX-ERROR.') {
            return null;
        }
        $mailbox = isset($ent->mailbox) ? (string) $ent->mailbox : '';
        $email = ($mailbox !== '' && $host !== '') ? $mailbox.'@'.$host : '';
        if ($email === '') {
            return null;
        }
        $personal = $ent->personal ?? false;
        $row = ['email' => $email];
        if (is_string($personal) && $personal !== '') {
            $row['name'] = self::decodeMime($personal);
        }

        return $row;
    }

    /**
     * @param  list<object>|object|null|false  $addrs  {@code imap_headerinfo()} may use {@code false} when empty.
     * @return list<array{name?: string, email: string}>
     */
    public static function normalizeAddressObjects(array|object|null|false $addrs): array
    {
        if ($addrs === null || $addrs === false) {
            return [];
        }
        $list = is_array($addrs) ? $addrs : [$addrs];
        $out = [];
        foreach ($list as $ent) {
            if (! is_object($ent)) {
                continue;
            }
            $row = self::addressObjectToRow($ent);
            if ($row !== null) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * Parse a raw {@code To:}/{@code Cc:} header value (as returned by {@code imap_fetch_overview()}).
     *
     * @return list<array{name?: string, email: string}>
     */
    public static function parseAddressListHeader(string $header): array
    {
        $header = trim($header);
        if ($header === '' || ! function_exists('imap_rfc822_parse_adrlist')) {
            return [];
        }
        $parsed = @imap_rfc822_parse_adrlist($header, 'invalid.local');
        if (! is_array($parsed)) {
            return [];
        }
        $out = [];
        foreach ($parsed as $ent) {
            if (! is_object($ent)) {
                continue;
            }
            $row = self::addressObjectToRow($ent);
            if ($row !== null) {
                $out[] = $row;
            }
        }

        return $out;
    }

    private static function decodeMime(string $s): string
    {
        if (function_exists('iconv_mime_decode')) {
            $d = @iconv_mime_decode($s, \ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');

            return is_string($d) ? $d : $s;
        }

        return $s;
    }
}
