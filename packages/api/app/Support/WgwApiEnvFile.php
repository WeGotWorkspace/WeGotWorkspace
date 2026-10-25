<?php

declare(strict_types=1);

namespace App\Support;

use Dotenv\Exception\InvalidFileException;
use Dotenv\Parser\Parser;
use Dotenv\Parser\Value;

/**
 * Read/write helpers for packages/api/.env without booting Laravel.
 */
final class WgwApiEnvFile
{
    public static function readPath(string $envPath, string $key): ?string
    {
        if (! is_readable($envPath)) {
            return null;
        }

        return self::readValue((string) file_get_contents($envPath), $key);
    }

    /**
     * The value dotenv loads for $key, read with dotenv's own parser but
     * without throwing: the last line that sets $key wins and is parsed on its
     * own, so a torn line elsewhere does not matter. Quotes, escapes, inline
     * comments, CRLF, `export` and spaces around `=` behave as at boot. Empty
     * string for an empty or unparsable value; null when no line sets $key.
     * `${VAR}` references come back as written; Laravel expands them.
     *
     * Not supported (we never write them): multi-line quoted values read as
     * empty, and a `KEY=` line inside another key's multi-line value is read
     * (and rewritten by setLine()) although dotenv treats it as that value.
     */
    public static function readValue(string $content, string $key): ?string
    {
        if (preg_match_all(self::lineRegex($key), $content, $matches) < 1) {
            return null;
        }

        try {
            $entries = (new Parser)->parse((string) end($matches[0]));
        } catch (InvalidFileException) {
            return '';
        }
        $value = end($entries);

        return $value === false ? '' : $value->getValue()->map(static fn (Value $v): string => $v->getChars())->getOrElse('');
    }

    public static function hasKey(string $content, string $key): bool
    {
        return preg_match(self::lineRegex($key), $content) === 1;
    }

    /**
     * Replace every line that sets $key with `KEY=value`, or append one.
     * With $quote false the value is written raw: only pass values already
     * validated to hold no whitespace, newlines, quotes, `#` or `$`.
     */
    public static function setLine(string $content, string $key, string $value, bool $quote = true): string
    {
        $line = $quote
            ? $key.'='.self::quoteValue($value)
            : $key.'='.$value;
        if (self::hasKey($content, $key)) {
            // A callback, so `$1` or `\0` in the value is not read as a backreference.
            return (string) preg_replace_callback(self::lineRegex($key), static fn (): string => $line, $content);
        }

        return rtrim($content)."\n".$line."\n";
    }

    /**
     * Every line that sets $key, in the shapes dotenv accepts: indent,
     * `export`, spaces around `=`. setLine() rewrites them all to `KEY=value`.
     */
    private static function lineRegex(string $key): string
    {
        return '/^[ \t]*(?:export[ \t]+)?'.preg_quote($key, '/').'[ \t]*=[^\r\n]*/m';
    }

    /**
     * The value as dotenv will load it back, quoted when needed. `$` is
     * escaped so Laravel does not expand `${...}` in a written value.
     */
    public static function quoteValue(string $value): string
    {
        if ($value === '' || preg_match('/[\s#="\'$]/', $value) === 1) {
            return '"'.str_replace(['\\', '"', '$'], ['\\\\', '\\"', '\\$'], $value).'"';
        }

        return $value;
    }

    /**
     * True when {@code $envPath} has non-empty WGW_DB_CONNECTION and WGW_DB_DATABASE.
     * Unlike {@see hasRealDatabaseConfig()}, example-identical SQLite counts.
     */
    public static function hasDatabaseConfigKeys(string $envPath): bool
    {
        $connection = self::readPath($envPath, 'WGW_DB_CONNECTION') ?? '';
        $database = self::readPath($envPath, 'WGW_DB_DATABASE') ?? '';

        return $connection !== '' && $database !== '';
    }

    /**
     * @param  array<string, string>  $pairs
     */
    public static function containsPairs(string $content, array $pairs): bool
    {
        foreach ($pairs as $key => $value) {
            if ((self::readValue($content, $key) ?? '') !== $value) {
                return false;
            }
        }

        return true;
    }

    /**
     * Drop lines that are not comments and not KEY=value (e.g. a torn "reply@example.com").
     */
    public static function stripInvalidLines(string $content): string
    {
        $endedWithNewline = str_ends_with($content, "\n") || str_ends_with($content, "\r");
        $lines = preg_split("/\r\n|\n|\r/", $content);
        if (! is_array($lines)) {
            return $content;
        }
        $kept = [];
        foreach ($lines as $line) {
            $trim = ltrim($line);
            if ($trim === '' || str_starts_with($trim, '#') || str_starts_with($trim, 'export ')) {
                $kept[] = $line;

                continue;
            }
            if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*\s*=/', $trim) !== 1) {
                continue;
            }
            $kept[] = $line;
        }
        $out = implode("\n", $kept);
        if ($endedWithNewline && ($out === '' || ! str_ends_with($out, "\n"))) {
            $out .= "\n";
        }

        return $out;
    }

    /**
     * True when {@code $envPath} has WGW_DB_* values that differ from sibling .env.example.
     */
    public static function hasRealDatabaseConfig(string $envPath): bool
    {
        if (! is_readable($envPath)) {
            return false;
        }

        $content = (string) file_get_contents($envPath);
        $connection = self::readValue($content, 'WGW_DB_CONNECTION');
        if ($connection === null || $connection === '') {
            return false;
        }

        $database = self::readValue($content, 'WGW_DB_DATABASE');
        if ($database === null || $database === '') {
            return false;
        }

        $examplePath = dirname($envPath).'/.env.example';
        if (! is_readable($examplePath)) {
            return true;
        }

        $example = (string) file_get_contents($examplePath);
        $exampleConnection = self::readValue($example, 'WGW_DB_CONNECTION');
        $exampleDatabase = self::readValue($example, 'WGW_DB_DATABASE');

        return ! ($connection === $exampleConnection && $database === $exampleDatabase);
    }
}
