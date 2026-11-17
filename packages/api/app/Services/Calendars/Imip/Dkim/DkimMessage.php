<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * A whole message as DKIM sees it: header fields exactly as sent (folding
 * and final CRLF kept, top first) and the body. Bare LF line ends are
 * turned into CRLF first; IMAP should already deliver CRLF.
 */
final readonly class DkimMessage
{
    /**
     * @param  list<array{name: string, raw: string}>  $fields  name lower-case, raw ends with CRLF
     */
    private function __construct(
        public array $fields,
        public string $body,
    ) {}

    public static function parse(string $message): ?self
    {
        $message = (string) preg_replace('/(?<!\r)\n/', "\r\n", $message);
        if ($message === '' || str_starts_with($message, "\r\n")) {
            return null;
        }
        $split = strpos($message, "\r\n\r\n");
        if ($split === false) {
            $head = str_ends_with($message, "\r\n") ? $message : $message."\r\n";
            $body = '';
        } else {
            $head = substr($message, 0, $split + 2);
            $body = substr($message, $split + 4);
        }

        $fields = [];
        $name = null;
        $raw = '';
        foreach (explode("\r\n", substr($head, 0, -2)) as $line) {
            if ($line !== '' && ($line[0] === ' ' || $line[0] === "\t")) {
                if ($name === null) {
                    return null;
                }
                $raw .= $line."\r\n";

                continue;
            }
            if ($name !== null) {
                $fields[] = ['name' => $name, 'raw' => $raw];
            }
            $colon = strpos($line, ':');
            if ($colon === false || $colon === 0) {
                return null;
            }
            $name = strtolower(rtrim(substr($line, 0, $colon), " \t"));
            if (preg_match('/^[\x21-\x39\x3b-\x7e]+$/', $name) !== 1) {
                return null;
            }
            $raw = $line."\r\n";
        }
        // The head is not empty and cannot start with a continuation line, so a field is open here.
        $fields[] = ['name' => $name, 'raw' => $raw];

        return new self($fields, $body);
    }

    /**
     * The value of a field (after the colon), unfolded and trimmed.
     */
    public static function value(string $raw): string
    {
        $colon = (int) strpos($raw, ':');

        return trim((string) preg_replace('/\r\n(?=[ \t])/', '', substr($raw, $colon + 1)), " \t\r\n");
    }

    /**
     * Every unfolded value of a field, top first.
     *
     * @return list<string>
     */
    public function all(string $name): array
    {
        $values = [];
        foreach ($this->fields as $field) {
            if ($field['name'] === $name) {
                $values[] = self::value($field['raw']);
            }
        }

        return $values;
    }
}
