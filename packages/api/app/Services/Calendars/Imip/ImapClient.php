<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * The few IMAP4rev1 (RFC 3501) commands reply ingest needs. The folder is
 * opened with EXAMINE and every body fetch uses BODY.PEEK, so nothing in
 * the mailbox changes: no flags, no moves, no deletes.
 */
final class ImapClient
{
    /** Longest single response line accepted (a long UID SEARCH result). */
    private const MAX_LINE_BYTES = 1_048_576;

    /** Largest literal accepted; message bodies above the size cap are never fetched. */
    private const MAX_LITERAL_BYTES = 2_097_152;

    /** Largest whole response to one command. */
    private const MAX_RESPONSE_BYTES = 8_388_608;

    /** Header fields fetched per message; nothing else of the header is read. */
    public const HEADER_FIELDS = ['FROM', 'SENDER', 'MESSAGE-ID', 'AUTHENTICATION-RESULTS'];

    private int $tagCounter = 0;

    private bool $connected = false;

    public function __construct(private readonly ImapTransport $transport) {}

    /** Connect, upgrade to TLS when asked, and log in. */
    public function connect(ImapEndpoint $endpoint, string $login, string $password): void
    {
        $this->transport->open($endpoint);
        $this->connected = true;
        $greeting = $this->readLogicalLine(self::MAX_RESPONSE_BYTES);
        if (preg_match('/^\* (OK|PREAUTH)\b/i', $greeting) !== 1) {
            $this->close();

            throw new ImapException(ImapException::CONNECT_FAILED, 'The mail server refused the connection.');
        }
        if ($endpoint->security === ImapEndpoint::SECURITY_STARTTLS) {
            $this->command('STARTTLS', ImapException::TLS_FAILED);
            $this->transport->startTls();
        }
        $this->login($login, $password);
    }

    /**
     * @return array{uidvalidity: int, uidnext: int|null, exists: int}
     */
    public function examine(string $folder): array
    {
        $response = $this->command('EXAMINE '.$this->quote($this->mailboxName($folder)), ImapException::FOLDER_MISSING);
        $uidValidity = null;
        $uidNext = null;
        $exists = 0;
        foreach ($response as $line) {
            if (preg_match('/^\* OK \[UIDVALIDITY (\d+)\]/i', $line, $match) === 1) {
                $uidValidity = (int) $match[1];
            } elseif (preg_match('/^\* OK \[UIDNEXT (\d+)\]/i', $line, $match) === 1) {
                $uidNext = (int) $match[1];
            } elseif (preg_match('/^\* (\d+) EXISTS/i', $line, $match) === 1) {
                $exists = (int) $match[1];
            }
        }
        if ($uidValidity === null) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server did not report UIDVALIDITY.');
        }

        return ['uidvalidity' => $uidValidity, 'uidnext' => $uidNext, 'exists' => $exists];
    }

    /** Highest UID in the examined folder, 0 when it is empty. */
    public function highestUid(int $exists, ?int $uidNext): int
    {
        if ($exists === 0) {
            return 0;
        }
        if ($uidNext !== null && $uidNext > 0) {
            return $uidNext - 1;
        }
        $highest = 0;
        foreach ($this->command('UID FETCH * (UID)', ImapException::PROTOCOL_ERROR) as $line) {
            if (preg_match('/^\* \d+ FETCH \(.*\bUID (\d+)/i', $line, $match) === 1) {
                $highest = max($highest, (int) $match[1]);
            }
        }

        return $highest;
    }

    /**
     * UIDs above $afterUid, ascending.
     *
     * @return list<int>
     */
    public function uidsAfter(int $afterUid): array
    {
        $uids = [];
        foreach ($this->command('UID SEARCH UID '.($afterUid + 1).':*', ImapException::PROTOCOL_ERROR) as $line) {
            if (preg_match('/^\* SEARCH\b(.*)$/i', $line, $match) !== 1) {
                continue;
            }
            foreach (preg_split('/\s+/', trim($match[1])) ?: [] as $uid) {
                if (ctype_digit($uid) && (int) $uid > $afterUid) {
                    $uids[(int) $uid] = true;
                }
            }
        }
        $list = array_keys($uids);
        sort($list);

        return $list;
    }

    /**
     * Size, structure and the selected header fields for each UID.
     *
     * @param  list<int>  $uids
     * @return array<int, ImapMessageSummary>
     */
    public function summaries(array $uids): array
    {
        if ($uids === []) {
            return [];
        }
        $headerItem = 'BODY.PEEK[HEADER.FIELDS ('.implode(' ', self::HEADER_FIELDS).')]';
        $response = $this->command(
            'UID FETCH '.implode(',', $uids).' (UID RFC822.SIZE BODYSTRUCTURE '.$headerItem.')',
            ImapException::PROTOCOL_ERROR,
        );
        $out = [];
        foreach ($this->fetchItems($response) as $items) {
            $uid = isset($items['UID']) && is_string($items['UID']) && ctype_digit($items['UID']) ? (int) $items['UID'] : null;
            if ($uid === null) {
                continue;
            }
            $headers = '';
            foreach ($items as $key => $value) {
                if (str_starts_with($key, 'BODY[HEADER.FIELDS') && is_string($value)) {
                    $headers = $value;
                }
            }
            $structure = $items['BODYSTRUCTURE'] ?? null;
            $out[$uid] = new ImapMessageSummary(
                uid: $uid,
                size: isset($items['RFC822.SIZE']) && is_string($items['RFC822.SIZE']) ? (int) $items['RFC822.SIZE'] : 0,
                headers: MailHeaders::parse($headers),
                calendarPart: is_array($structure) ? ImapBodyStructure::calendarPart($structure) : null,
            );
        }

        return $out;
    }

    /** The raw (still transfer-encoded) bytes of one body section. */
    public function section(int $uid, string $section): ?string
    {
        if (preg_match('/^\d+(\.\d+)*$/', $section) !== 1) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'Invalid body section.');
        }
        $response = $this->command('UID FETCH '.$uid.' (UID BODY.PEEK['.$section.'])', ImapException::PROTOCOL_ERROR);
        foreach ($this->fetchItems($response) as $items) {
            if (($items['UID'] ?? null) !== (string) $uid) {
                continue;
            }
            $value = $items['BODY['.$section.']'] ?? null;

            return is_string($value) ? $value : null;
        }

        return null;
    }

    public function logout(): void
    {
        if (! $this->connected) {
            return;
        }
        try {
            $this->command('LOGOUT', ImapException::PROTOCOL_ERROR);
        } catch (ImapException) {
            // Closing anyway.
        }
        $this->close();
    }

    public function close(): void
    {
        $this->transport->close();
        $this->connected = false;
    }

    private function login(string $login, string $password): void
    {
        $tag = $this->nextTag();
        $this->sendWithArguments($tag, 'LOGIN', [$login, $password], ImapException::AUTH_FAILED);
        $this->readTagged($tag, ImapException::AUTH_FAILED);
    }

    /**
     * Send `tag NAME arg arg`, using a synchronizing literal for any argument
     * that a quoted string cannot carry (8-bit bytes).
     *
     * @param  list<string>  $arguments
     */
    private function sendWithArguments(string $tag, string $name, array $arguments, string $errorCode): void
    {
        $line = $tag.' '.$name;
        foreach ($arguments as $argument) {
            if (preg_match('/[\x00\r\n]/', $argument) === 1) {
                throw new ImapException($errorCode, 'The value contains characters IMAP cannot send.');
            }
            if (preg_match('/[\x80-\xff]/', $argument) !== 1) {
                $line .= ' '.$this->quote($argument);

                continue;
            }
            $this->transport->write($line.' {'.strlen($argument)."}\r\n");
            $continuation = $this->readLogicalLine(self::MAX_LINE_BYTES);
            if (! str_starts_with($continuation, '+')) {
                throw new ImapException($errorCode, 'The mail server did not accept the value.');
            }
            $line = $argument;
        }
        $this->transport->write($line."\r\n");
    }

    /**
     * @return list<string> untagged lines (without CRLF)
     */
    private function command(string $command, string $errorCode): array
    {
        $tag = $this->nextTag();
        $this->transport->write($tag.' '.$command."\r\n");

        return $this->readTagged($tag, $errorCode);
    }

    /**
     * @return list<string>
     */
    private function readTagged(string $tag, string $errorCode): array
    {
        $untagged = [];
        $budget = self::MAX_RESPONSE_BYTES;
        while (true) {
            $line = $this->readLogicalLine($budget);
            $budget -= strlen($line);
            if (str_starts_with($line, $tag.' ')) {
                $status = strtoupper((string) strtok(substr($line, strlen($tag) + 1), ' '));
                if ($status !== 'OK') {
                    throw new ImapException($errorCode, 'The mail server answered '.$status.'.');
                }

                return $untagged;
            }
            if (preg_match('/^\* BYE\b/i', $line) === 1) {
                $this->close();

                throw new ImapException(ImapException::CONNECT_FAILED, 'The mail server closed the session.');
            }
            if (str_starts_with($line, '* ')) {
                $untagged[] = $line;
            }
        }
    }

    /** One response line with any literals inline, without the final CRLF. */
    private function readLogicalLine(int $budget): string
    {
        $raw = '';
        while (true) {
            $line = $this->transport->readLine(self::MAX_LINE_BYTES);
            $raw .= $line;
            if (preg_match('/\{(\d{1,9})\+?\}\r?\n$/', $line, $match) !== 1) {
                break;
            }
            $size = (int) $match[1];
            if ($size > self::MAX_LITERAL_BYTES) {
                throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server sent a literal above the size cap.');
            }
            $raw .= $this->transport->read($size);
            if (strlen($raw) > $budget) {
                throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server response is too large.');
            }
        }
        if (strlen($raw) > $budget) {
            throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server response is too large.');
        }

        return rtrim($raw, "\r\n");
    }

    /**
     * FETCH item maps (`KEY => value`) from untagged `* n FETCH (...)` lines.
     *
     * @param  list<string>  $lines
     * @return list<array<string, mixed>>
     */
    private function fetchItems(array $lines): array
    {
        $out = [];
        foreach ($lines as $line) {
            if (preg_match('/^\* \d+ FETCH /i', $line) !== 1) {
                continue;
            }
            $parsed = ImapResponseParser::parse(substr($line, 2));
            $list = $parsed[2] ?? null;
            if (! is_array($list)) {
                continue;
            }
            $items = [];
            for ($i = 0; $i + 1 < count($list); $i += 2) {
                $key = $list[$i];
                if (! is_string($key)) {
                    continue;
                }
                $items[$this->itemKey($key)] = $list[$i + 1];
            }
            $out[] = $items;
        }

        return $out;
    }

    /** `body.peek[1.2]` and `BODY[1.2]<0>` both become `BODY[1.2]`; other keys upper-case. */
    private function itemKey(string $key): string
    {
        $upper = strtoupper($key);
        if (preg_match('/^BODY(?:\.PEEK)?(\[[^\]]*\])/', $upper, $match) === 1) {
            return 'BODY'.$match[1];
        }

        return $upper;
    }

    private function quote(string $value): string
    {
        return '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], $value).'"';
    }

    private function mailboxName(string $folder): string
    {
        if (preg_match('/[\x80-\xff]/', $folder) !== 1) {
            return $folder;
        }

        return mb_convert_encoding($folder, 'UTF7-IMAP', 'UTF-8');
    }

    private function nextTag(): string
    {
        $this->tagCounter++;

        return 'W'.$this->tagCounter;
    }
}
