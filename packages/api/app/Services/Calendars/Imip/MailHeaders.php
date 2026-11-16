<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Header fields of one message in the order they appear, top first.
 * Unfolded (RFC 5322 2.2.3); values are otherwise left as sent.
 */
final readonly class MailHeaders
{
    /**
     * @param  list<array{name: string, value: string}>  $fields  names lower-case
     */
    public function __construct(public array $fields) {}

    public static function parse(string $block): self
    {
        $unfolded = preg_replace('/\r?\n[ \t]+/', ' ', $block) ?? '';
        $fields = [];
        foreach (preg_split('/\r?\n/', $unfolded) ?: [] as $line) {
            $colon = strpos($line, ':');
            if ($colon === false || $colon === 0) {
                continue;
            }
            $name = strtolower(trim(substr($line, 0, $colon)));
            if (preg_match('/^[\x21-\x39\x3b-\x7e]+$/', $name) !== 1) {
                continue;
            }
            $fields[] = ['name' => $name, 'value' => trim(substr($line, $colon + 1))];
        }

        return new self($fields);
    }

    /**
     * Every value of $name, top first.
     *
     * @return list<string>
     */
    public function all(string $name): array
    {
        $name = strtolower($name);
        $values = [];
        foreach ($this->fields as $field) {
            if ($field['name'] === $name) {
                $values[] = $field['value'];
            }
        }

        return $values;
    }

    public function first(string $name): ?string
    {
        return $this->all($name)[0] ?? null;
    }
}
