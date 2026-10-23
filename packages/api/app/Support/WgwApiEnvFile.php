<?php

declare(strict_types=1);

namespace App\Support;

use Dotenv\Exception\InvalidFileException;
use Dotenv\Parser\Parser;

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
     * The raw value Laravel loads for $key, parsed with dotenv's own parser:
     * last entry wins, CRLF, `export`, spaces around `=`, quotes and inline
     * comments behave exactly as at boot. Empty string for an empty value;
     * null when the key is absent.
     *
     * @throws InvalidFileException when dotenv cannot parse the content (Laravel would not boot either)
     */
    public static function readEffectiveValue(string $content, string $key): ?string
    {
        $value = null;
        foreach ((new Parser)->parse($content) as $entry) {
            if ($entry->getName() === $key) {
                $value = $entry->getValue()->map(static fn ($v) => $v->getChars())->getOrElse('');
            }
        }

        return $value;
    }

    /**
     * First `KEY=` match only, value up to the first whitespace. This is not
     * how dotenv reads duplicate or empty keys; use readEffectiveValue() when
     * the loaded value matters.
     */
    public static function readValue(string $content, string $key): ?string
    {
        if (preg_match('/^'.preg_quote($key, '/').'\s*=\s*(\S+)/m', $content, $match) !== 1) {
            return null;
        }

        return trim($match[1], " \t\"'");
    }

    public static function hasKey(string $content, string $key): bool
    {
        return preg_match('/^'.preg_quote($key, '/').'=.*/m', $content) === 1;
    }

    public static function setLine(string $content, string $key, string $value, bool $quote = true): string
    {
        $line = $quote
            ? $key.'='.self::quoteValue($value)
            : $key.'='.$value;
        if (self::hasKey($content, $key)) {
            return (string) preg_replace('/^'.preg_quote($key, '/').'=.*/m', $line, $content);
        }

        return rtrim($content)."\n".$line."\n";
    }

    public static function quoteValue(string $value): string
    {
        if ($value === '' || preg_match('/[\s#="\']/', $value) === 1) {
            return '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], $value).'"';
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
