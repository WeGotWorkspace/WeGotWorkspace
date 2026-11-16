<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapException;
use App\Services\Calendars\Imip\ImapTransport;

/**
 * In-memory IMAP server behind {@see ImapTransport} for tests: LOGIN,
 * STARTTLS, EXAMINE, UID SEARCH, UID FETCH and LOGOUT over a fixed set of
 * messages. Each message gives its size, header block, BODYSTRUCTURE text
 * and raw body sections. Every command the client sent is in `$commands`.
 */
final class FakeImapServer implements ImapTransport
{
    /** @var list<string> */
    public array $commands = [];

    public int $opens = 0;

    public ?ImapEndpoint $endpoint = null;

    public bool $tls = false;

    private string $output = '';

    private string $pendingLiteralCommand = '';

    private int $pendingLiteralBytes = 0;

    /**
     * @param  array<int, array{size?: int, headers: string, structure: string, sections?: array<string, string>}>  $messages
     */
    public function __construct(
        public array $messages = [],
        public int $uidValidity = 1,
        public string $login = 'organizer@example.test',
        public string $password = 'secret',
        public string $folder = 'INBOX',
        public bool $sendUidNext = true,
    ) {}

    public function open(ImapEndpoint $endpoint): void
    {
        $this->opens++;
        $this->endpoint = $endpoint;
        $this->tls = $endpoint->security === ImapEndpoint::SECURITY_SSL;
        $this->output = "* OK [CAPABILITY IMAP4rev1 STARTTLS] Fake ready\r\n";
    }

    public function startTls(): void
    {
        $this->tls = true;
    }

    public function write(string $bytes): void
    {
        if ($this->pendingLiteralBytes > 0) {
            $literal = substr($bytes, 0, $this->pendingLiteralBytes);
            $rest = substr($bytes, $this->pendingLiteralBytes);
            $this->pendingLiteralBytes = 0;
            $bytes = $this->pendingLiteralCommand.'"'.addcslashes($literal, '"\\').'"'.$rest;
            $this->pendingLiteralCommand = '';
        }
        if (preg_match('/^(.*)\{(\d+)\}\r\n$/s', $bytes, $match) === 1) {
            $this->pendingLiteralCommand = $match[1];
            $this->pendingLiteralBytes = (int) $match[2];
            $this->output .= "+ go ahead\r\n";

            return;
        }
        $line = rtrim($bytes, "\r\n");
        $this->commands[] = preg_replace('/^(\S+ LOGIN "[^"]*") .*/', '$1 "***"', $line) ?? $line;
        [$tag, $rest] = explode(' ', $line, 2) + [1 => ''];
        $this->output .= $this->handle($tag, $rest);
    }

    public function readLine(int $maxBytes): string
    {
        $end = strpos($this->output, "\n");
        if ($end === false) {
            throw new ImapException(ImapException::CONNECT_FAILED, 'Fake server has nothing to say.');
        }
        $line = substr($this->output, 0, $end + 1);
        $this->output = substr($this->output, $end + 1);

        return $line;
    }

    public function read(int $length): string
    {
        $chunk = substr($this->output, 0, $length);
        $this->output = substr($this->output, $length);

        return $chunk;
    }

    public function close(): void {}

    /** Commands without tags, for assertions. @return list<string> */
    public function verbs(): array
    {
        return array_map(static fn (string $line): string => (string) preg_replace('/^\S+ /', '', $line), $this->commands);
    }

    private function handle(string $tag, string $command): string
    {
        $upper = strtoupper($command);
        if (str_starts_with($upper, 'STARTTLS')) {
            return $tag." OK Begin TLS\r\n";
        }
        if (str_starts_with($upper, 'LOGIN ')) {
            preg_match('/^LOGIN "((?:[^"\\\\]|\\\\.)*)" "((?:[^"\\\\]|\\\\.)*)"$/s', $command, $match);
            $login = stripcslashes($match[1] ?? '');
            $password = stripcslashes($match[2] ?? '');

            return $login === $this->login && $password === $this->password
                ? $tag." OK Logged in\r\n"
                : $tag." NO [AUTHENTICATIONFAILED] Invalid credentials\r\n";
        }
        if (str_starts_with($upper, 'EXAMINE ')) {
            if (trim(substr($command, 8), '"') !== $this->folder) {
                return $tag." NO Mailbox does not exist\r\n";
            }
            $uids = array_keys($this->messages);
            $next = $uids === [] ? 1 : max($uids) + 1;
            $out = '* '.count($this->messages)." EXISTS\r\n* OK [UIDVALIDITY {$this->uidValidity}] UIDs valid\r\n";
            if ($this->sendUidNext) {
                $out .= "* OK [UIDNEXT {$next}] Predicted next UID\r\n";
            }

            return $out.$tag." OK [READ-ONLY] Examine completed\r\n";
        }
        if (preg_match('/^UID SEARCH UID (\d+):\*$/i', $command, $match) === 1) {
            $from = (int) $match[1];
            $hits = array_filter(array_keys($this->messages), static fn (int $uid): bool => $uid >= $from);
            if ($hits === [] && $this->messages !== []) {
                // RFC 3501: `n:*` always includes the highest UID.
                $hits = [max(array_keys($this->messages))];
            }
            sort($hits);

            return '* SEARCH'.($hits === [] ? '' : ' '.implode(' ', $hits))."\r\n".$tag." OK Search completed\r\n";
        }
        if (preg_match('/^UID FETCH (\S+) \((.*)\)$/i', $command, $match) === 1) {
            return $this->fetch($tag, $match[1], $match[2]);
        }
        if ($upper === 'LOGOUT') {
            return "* BYE Logging out\r\n".$tag." OK Logout completed\r\n";
        }

        return $tag." BAD Unknown command\r\n";
    }

    private function fetch(string $tag, string $set, string $items): string
    {
        $uids = array_keys($this->messages);
        if ($set === '*') {
            $wanted = $uids === [] ? [] : [max($uids)];
        } else {
            $wanted = array_map('intval', explode(',', $set));
        }
        $out = '';
        $sequence = 0;
        foreach ($wanted as $uid) {
            $message = $this->messages[$uid] ?? null;
            $sequence++;
            if ($message === null) {
                continue;
            }
            $parts = ['UID '.$uid];
            if (str_contains($items, 'RFC822.SIZE')) {
                $parts[] = 'RFC822.SIZE '.($message['size'] ?? 1000);
            }
            if (str_contains($items, 'BODYSTRUCTURE')) {
                $parts[] = 'BODYSTRUCTURE '.$message['structure'];
            }
            if (preg_match('/BODY\.PEEK\[(HEADER\.FIELDS \([^)]*\))\]/', $items, $header) === 1) {
                $parts[] = 'BODY['.$header[1].'] {'.strlen($message['headers'])."}\r\n".$message['headers'];
            }
            if (preg_match('/BODY\.PEEK\[([\d.]+)\]/', $items, $section) === 1) {
                $body = $message['sections'][$section[1]] ?? '';
                $parts[] = 'BODY['.$section[1].'] {'.strlen($body)."}\r\n".$body;
            }
            $out .= '* '.$sequence.' FETCH ('.implode(' ', $parts).")\r\n";
        }

        return $out.$tag." OK Fetch completed\r\n";
    }
}
