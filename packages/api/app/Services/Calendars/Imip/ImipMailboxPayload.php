<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarReplyMailbox;
use Illuminate\Support\Facades\RateLimiter;

/**
 * REST shape of the caller's reply mailbox (`/calendars/reply-mailbox`). The
 * password is write-only: responses only say whether one is stored. Saving
 * logs in first, so a wrong password or host is reported at once.
 */
final class ImipMailboxPayload
{
    private const MAX_HOST = 255;

    private const MAX_LOGIN = 320;

    private const MAX_PASSWORD = 1024;

    private const MAX_FOLDER = 255;

    /** Logins a user may trigger by saving or testing, per window. Each one dials out. */
    private const TESTS_PER_WINDOW = 10;

    private const TEST_WINDOW_SECONDS = 600;

    public function __construct(
        private readonly ImipMailboxSettings $settings,
        private readonly ImipMailboxPoller $poller,
    ) {}

    /**
     * @return array{mailbox: array<string, mixed>|null}
     */
    public function show(string $username): array
    {
        $mailbox = $this->settings->find($username);

        return ['mailbox' => $mailbox !== null ? $this->present($mailbox) : null];
    }

    /**
     * @return array{mailbox: array<string, mixed>|null}
     */
    public function update(string $username, mixed $payload): array
    {
        if (! is_array($payload)) {
            throw new ApiHttpException(400, 'Request body must be a JSON object.', 'bad_request');
        }
        $existing = $this->settings->find($username);
        $fields = [
            'host' => $this->host($payload['host'] ?? null),
            'security' => $this->security($payload['security'] ?? null),
            'login' => $this->text($payload['username'] ?? null, 'username', self::MAX_LOGIN, true),
            'folder' => $this->folder($payload['folder'] ?? null),
        ];
        $fields['port'] = $this->port($payload['port'] ?? null, $fields['security']);
        $password = array_key_exists('password', $payload) && $payload['password'] !== null
            ? $this->text($payload['password'], 'password', self::MAX_PASSWORD, false)
            : null;
        if ($password === '') {
            $password = null;
        }
        if ($password === null && $existing === null) {
            throw new ApiHttpException(400, 'password is required.', 'bad_request');
        }
        if ($password === null && ($existing->host !== $fields['host'] || (int) $existing->port !== $fields['port'])) {
            throw new ApiHttpException(400, 'password is required when the host or port changes.', 'bad_request');
        }
        $loginPassword = $password ?? $this->settings->password($existing);

        $test = $this->connectionTest($username, $fields, $loginPassword);
        $this->settings->save($username, $fields, $password, $test);

        return $this->show($username);
    }

    /**
     * Log in again with the stored settings and refresh the trusted server.
     *
     * @return array{mailbox: array<string, mixed>|null}
     */
    public function test(string $username): array
    {
        $mailbox = $this->settings->find($username);
        if ($mailbox === null) {
            throw new ApiHttpException(404, 'No reply mailbox is connected.', 'not_found');
        }
        $fields = [
            'host' => (string) $mailbox->host,
            'port' => (int) $mailbox->port,
            'security' => (string) $mailbox->security,
            'login' => (string) $mailbox->login,
            'folder' => (string) $mailbox->folder,
        ];
        $test = $this->connectionTest($username, $fields, $this->settings->password($mailbox));
        $this->settings->save($username, $fields, null, $test);

        return $this->show($username);
    }

    public function delete(string $username): void
    {
        $this->settings->delete($username);
    }

    /**
     * @param  array{host: string, port: int, security: string, login: string, folder: string}  $fields
     * @return array{trustedServerId: string, uidValidity: int, highestUid: int}
     */
    private function connectionTest(string $username, array $fields, string $password): array
    {
        $key = 'calendar-reply-mailbox-test:user:'.$username;
        if (RateLimiter::tooManyAttempts($key, self::TESTS_PER_WINDOW)) {
            throw new ApiHttpException(
                429,
                'Too many requests.',
                'rate_limited',
                [],
                ['Retry-After' => max(1, RateLimiter::availableIn($key))],
            );
        }
        RateLimiter::hit($key, self::TEST_WINDOW_SECONDS);
        try {
            return $this->poller->test(
                $fields['host'],
                $fields['port'],
                $fields['security'],
                $fields['login'],
                $password,
                $fields['folder'],
            );
        } catch (ImapException $exception) {
            throw new ApiHttpException(422, $this->failureSentence($exception->errorCode), $exception->errorCode);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function present(CalendarReplyMailbox $mailbox): array
    {
        $trusted = (string) $mailbox->trusted_server_id;

        return [
            'host' => (string) $mailbox->host,
            'port' => (int) $mailbox->port,
            'security' => (string) $mailbox->security,
            'username' => (string) $mailbox->login,
            'folder' => (string) $mailbox->folder,
            'passwordSet' => (string) $mailbox->password_enc !== '',
            'trustedServer' => $trusted !== '' ? $trusted : null,
            'active' => (bool) $mailbox->enabled,
            'lastCheckedAt' => $this->iso($mailbox->last_polled_at),
            'lastSuccessAt' => $this->iso($mailbox->last_success_at),
            'lastError' => $mailbox->last_error_code !== null && $mailbox->last_error_code !== ''
                ? (string) $mailbox->last_error_code
                : null,
        ];
    }

    private function iso(?int $timestamp): ?string
    {
        return $timestamp !== null && $timestamp > 0 ? gmdate('Y-m-d\TH:i:s\Z', $timestamp) : null;
    }

    private function host(mixed $value): string
    {
        $host = strtolower($this->text($value, 'host', self::MAX_HOST, true));
        if (preg_match('/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/', $host) !== 1) {
            throw new ApiHttpException(400, 'host must be a host name or an IP address.', 'bad_request');
        }

        return $host;
    }

    private function security(mixed $value): string
    {
        if (! is_string($value) || ! in_array($value, [ImapEndpoint::SECURITY_SSL, ImapEndpoint::SECURITY_STARTTLS], true)) {
            throw new ApiHttpException(400, 'security must be ssl or starttls.', 'bad_request');
        }

        return $value;
    }

    private function port(mixed $value, string $security): int
    {
        if ($value === null) {
            return $security === ImapEndpoint::SECURITY_SSL ? 993 : 143;
        }
        if (! is_int($value) || $value < 1 || $value > 65535) {
            throw new ApiHttpException(400, 'port must be a number from 1 to 65535.', 'bad_request');
        }

        return $value;
    }

    private function folder(mixed $value): string
    {
        if ($value === null || $value === '') {
            return 'INBOX';
        }

        return $this->text($value, 'folder', self::MAX_FOLDER, true);
    }

    private function text(mixed $value, string $field, int $max, bool $trim): string
    {
        if (! is_string($value)) {
            throw new ApiHttpException(400, $field.' must be a string.', 'bad_request');
        }
        $text = $trim ? trim($value) : $value;
        if ($text === '' && $trim) {
            throw new ApiHttpException(400, $field.' is required.', 'bad_request');
        }
        if (strlen($text) > $max || preg_match('/[\x00-\x1f\x7f]/', $text) === 1 || ! mb_check_encoding($text, 'UTF-8')) {
            throw new ApiHttpException(400, $field.' is not valid.', 'bad_request');
        }

        return $text;
    }

    private function failureSentence(string $code): string
    {
        return match ($code) {
            ImapException::AUTH_FAILED => 'The mail server did not accept this username and password.',
            ImapException::FOLDER_MISSING => 'This folder does not exist in the mailbox.',
            ImapException::TLS_FAILED => 'A secure connection to the mail server failed.',
            ImapException::HOST_NOT_ALLOWED => 'This mail server address is not allowed.',
            default => 'Could not connect to the mail server.',
        };
    }
}
