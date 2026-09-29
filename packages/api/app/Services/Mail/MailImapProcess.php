<?php

declare(strict_types=1);

namespace App\Services\Mail;

use Symfony\Component\Process\Process;

/**
 * Runs mail IMAP work in a CLI subprocess when {@code ext-imap} crashes under Apache mod_php.
 */
final class MailImapProcess
{
    private const SUBPROCESS_ENV = 'WGW_MAIL_IMAP_SUBPROCESS';

    public static function shouldIsolate(): bool
    {
        if (getenv(self::SUBPROCESS_ENV) === '1') {
            return false;
        }

        $flag = getenv('WGW_IMAP_ISOLATE');
        if (is_string($flag) && $flag !== '') {
            $normalized = strtolower(trim($flag));
            if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
            if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
        }

        return PHP_SAPI === 'apache2handler';
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    public static function runJson(string $operation, string $username, array $params, callable $inline): array
    {
        if (! self::shouldIsolate()) {
            return $inline();
        }

        $decoded = self::decodeEnvelope(self::invoke($operation, $username, $params));
        if (isset($decoded['mailError']) && is_array($decoded['mailError'])) {
            $err = $decoded['mailError'];
            throw new MailResponseException(
                (int) ($err['status'] ?? 500),
                is_array($err['payload'] ?? null) ? $err['payload'] : ['error' => 'mail_error'],
            );
        }

        $result = $decoded['result'] ?? null;
        if (! is_array($result)) {
            throw new \RuntimeException('Mail IMAP subprocess returned invalid JSON.');
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $params
     */
    public static function runBinary(string $operation, string $username, array $params, callable $inline): MailBinaryDownload
    {
        if (! self::shouldIsolate()) {
            return $inline();
        }

        $decoded = self::decodeEnvelope(self::invoke($operation, $username, $params));
        if (isset($decoded['mailError']) && is_array($decoded['mailError'])) {
            $err = $decoded['mailError'];
            throw new MailResponseException(
                (int) ($err['status'] ?? 500),
                is_array($err['payload'] ?? null) ? $err['payload'] : ['error' => 'mail_error'],
            );
        }

        $result = $decoded['result'] ?? null;
        if (! is_array($result) || ($result['__binary'] ?? false) !== true) {
            throw new \RuntimeException('Mail IMAP subprocess returned invalid binary payload.');
        }

        $bytes = base64_decode((string) ($result['bytes'] ?? ''), true);
        if ($bytes === false) {
            throw new \RuntimeException('Mail IMAP subprocess returned corrupt binary data.');
        }

        return new MailBinaryDownload(
            (string) ($result['mime'] ?? 'application/octet-stream'),
            (string) ($result['filename'] ?? 'attachment'),
            $bytes,
        );
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private static function invoke(string $operation, string $username, array $params): array
    {
        $script = base_path('scripts/mail-imap-cli.php');
        if (! is_file($script)) {
            throw new \RuntimeException('Mail IMAP CLI script is missing: '.$script);
        }

        $payload = base64_encode(json_encode($params, JSON_THROW_ON_ERROR));
        $process = new Process(
            [self::phpCliBinary(), $script, $operation, $username, $payload],
            base_path(),
            self::subprocessEnvironment(),
            null,
            120,
        );
        $process->run();

        if (! $process->isSuccessful()) {
            $stderr = trim($process->getErrorOutput());
            throw new \RuntimeException(
                $stderr !== '' ? $stderr : 'Mail IMAP subprocess failed with exit code '.$process->getExitCode(),
            );
        }

        $stdout = self::extractJsonStdout($process->getOutput());

        return self::decodeEnvelope(json_decode($stdout, true, 512, JSON_THROW_ON_ERROR));
    }

    private static function extractJsonStdout(string $output): string
    {
        $trimmed = trim($output);
        if ($trimmed === '') {
            throw new \RuntimeException('Mail IMAP subprocess returned empty output.');
        }

        if (str_starts_with($trimmed, '{')) {
            return $trimmed;
        }

        $lines = preg_split('/\r\n|\r|\n/', $trimmed) ?: [];
        for ($i = count($lines) - 1; $i >= 0; $i--) {
            $line = trim($lines[$i]);
            if ($line !== '' && str_starts_with($line, '{')) {
                return $line;
            }
        }

        throw new \RuntimeException('Mail IMAP subprocess did not return JSON on stdout.');
    }

    /**
     * @return array<string, mixed>
     */
    private static function decodeEnvelope(mixed $decoded): array
    {
        if (! is_array($decoded) || ! array_key_exists('ok', $decoded)) {
            throw new \RuntimeException('Mail IMAP subprocess returned an unexpected envelope.');
        }

        return $decoded;
    }

    private static function phpCliBinary(): string
    {
        $fromEnv = getenv('WGW_PHP_CLI');
        if (is_string($fromEnv) && $fromEnv !== '' && is_executable($fromEnv)) {
            return $fromEnv;
        }

        if (defined('PHP_BINARY')) {
            $binary = PHP_BINARY;
            if (is_executable($binary)) {
                return $binary;
            }
        }

        if (defined('PHP_BINDIR')) {
            $candidate = PHP_BINDIR.'/php';
            if (is_executable($candidate)) {
                return $candidate;
            }
        }

        foreach (['/opt/homebrew/bin/php', '/usr/local/bin/php', '/usr/bin/php'] as $candidate) {
            if (is_executable($candidate)) {
                return $candidate;
            }
        }

        throw new \RuntimeException(
            'Cannot resolve PHP CLI for mail IMAP subprocess. Set WGW_PHP_CLI in the environment.',
        );
    }

    /**
     * @return array<string, string>
     */
    private static function subprocessEnvironment(): array
    {
        $env = [];
        foreach ($_SERVER as $key => $value) {
            if (! is_string($key) || ! is_string($value)) {
                continue;
            }
            if (str_starts_with($key, 'WGW_') || str_starts_with($key, 'SABRE_') || $key === 'PATH') {
                $env[$key] = $value;
            }
        }
        foreach ($_ENV as $key => $value) {
            if (is_string($key) && (is_string($value) || is_numeric($value))) {
                $env[$key] = (string) $value;
            }
        }
        $env[self::SUBPROCESS_ENV] = '1';
        if (! isset($env['WGW_APP_ROOT'])) {
            $root = getenv('WGW_APP_ROOT');
            if (is_string($root) && $root !== '') {
                $env['WGW_APP_ROOT'] = $root;
            }
        }

        return $env;
    }
}
