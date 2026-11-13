<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Models\CalendarReplyMailbox;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\Log;

/**
 * Reads new mail from reply mailboxes and hands calendar replies to
 * {@see ImipReplyIngest} (#1589). Runs from the minute scheduler: no daemon.
 *
 * - Each mailbox is polled at most every {@see MIN_INTERVAL_SECONDS}, oldest
 *   first, until the run's time budget is spent.
 * - The cursor is (UIDVALIDITY, last UID). A new mailbox or a new UIDVALIDITY
 *   starts at the current highest UID: mail from before is never replayed.
 * - The cursor moves past every UID looked at, so one bad message cannot
 *   block the box. It stays put while no trusted receiving server is known.
 */
class ImipMailboxPoller
{
    public const MIN_INTERVAL_SECONDS = 120;

    public const RUN_BUDGET_SECONDS = 40;

    public const BATCH_SIZE = 50;

    public const MAX_MESSAGE_BYTES = 1_048_576;

    /** Consecutive failed logins before polling pauses until the settings are saved again. */
    public const AUTH_FAILURE_PAUSE = 10;

    /** Newest messages read to learn the receiving server's id. */
    private const LEARN_SAMPLE = 20;

    public const UNTRUSTED_SERVER_UNKNOWN = 'untrusted_server_unknown';

    public const LOG_FAILED = 'calendar.imip_poll_failed';

    public function __construct(
        private readonly Container $container,
        private readonly ImipEndpointResolver $endpoints,
        private readonly ImipMailboxSettings $settings,
        private readonly ImipReplyIngest $ingest,
    ) {}

    /** Poll the mailboxes that are due. Returns how many were polled. */
    public function pollDue(?int $now = null): int
    {
        $started = microtime(true);
        $now ??= time();
        $polled = 0;
        $due = CalendarReplyMailbox::query()
            ->where('enabled', true)
            ->where(function ($query) use ($now): void {
                $query->whereNull('last_polled_at')
                    ->orWhere('last_polled_at', '<=', $now - self::MIN_INTERVAL_SECONDS);
            })
            ->orderByRaw('last_polled_at IS NOT NULL')
            ->orderBy('last_polled_at')
            ->get();
        foreach ($due as $mailbox) {
            if (microtime(true) - $started > self::RUN_BUDGET_SECONDS) {
                break;
            }
            $this->poll($mailbox, $now);
            $polled++;
        }

        return $polled;
    }

    public function poll(CalendarReplyMailbox $mailbox, ?int $now = null): void
    {
        $now ??= time();
        $mailbox->last_polled_at = $now;
        $mailbox->save();

        $client = $this->client();
        try {
            $client->connect(
                $this->endpoints->resolve((string) $mailbox->host, (int) $mailbox->port, (string) $mailbox->security),
                (string) $mailbox->login,
                $this->settings->password($mailbox),
            );
            $state = $client->examine((string) $mailbox->folder);
            $highest = $client->highestUid($state['exists'], $state['uidnext']);
            $error = $this->read($client, $mailbox, $state['uidvalidity'], $highest);
            $mailbox->last_success_at = $now;
            $mailbox->auth_failures = 0;
            $mailbox->last_error_code = $error;
            $mailbox->last_error_at = $error !== null ? $now : null;
        } catch (ImapException $exception) {
            $this->recordFailure($mailbox, $exception, $now);
        } finally {
            $client->logout();
        }
        $mailbox->save();
    }

    /**
     * Log in, open the folder and learn the receiving server id, without
     * reading any reply. Used when the settings are saved. Also returns the
     * folder's current UIDVALIDITY and highest UID, so a new mailbox reads
     * mail that arrives after this moment, not after its first poll.
     *
     * @return array{trustedServerId: string, uidValidity: int, highestUid: int}
     */
    public function test(string $host, int $port, string $security, string $login, string $password, string $folder): array
    {
        $client = $this->client();
        try {
            $client->connect($this->endpoints->resolve($host, $port, $security), $login, $password);
            $state = $client->examine($folder);
            $highest = $client->highestUid($state['exists'], $state['uidnext']);

            return [
                'trustedServerId' => $this->learnTrustedServerId($client, $highest),
                'uidValidity' => $state['uidvalidity'],
                'highestUid' => $highest,
            ];
        } finally {
            $client->logout();
        }
    }

    /** Reads new UIDs; returns an error code to show, or null. */
    private function read(ImapClient $client, CalendarReplyMailbox $mailbox, int $uidValidity, int $highest): ?string
    {
        if ($mailbox->uidvalidity !== $uidValidity || $mailbox->last_uid === null) {
            $mailbox->uidvalidity = $uidValidity;
            $mailbox->last_uid = $highest;
        }
        if ((string) $mailbox->trusted_server_id === '') {
            $learned = $this->learnTrustedServerId($client, $highest);
            if ($learned === '') {
                return self::UNTRUSTED_SERVER_UNKNOWN;
            }
            $mailbox->trusted_server_id = $learned;
        }

        $uids = array_slice($client->uidsAfter((int) $mailbox->last_uid), 0, self::BATCH_SIZE);
        $summaries = $client->summaries($uids);
        foreach ($uids as $uid) {
            $summary = $summaries[$uid] ?? null;
            if ($summary !== null) {
                $this->readMessage($client, $mailbox, $summary);
            }
            $mailbox->last_uid = $uid;
        }

        return null;
    }

    private function readMessage(ImapClient $client, CalendarReplyMailbox $mailbox, ImapMessageSummary $summary): void
    {
        $part = $summary->calendarPart;
        if ($part === null) {
            return;
        }
        $owner = (string) $mailbox->username;
        if ($summary->size > self::MAX_MESSAGE_BYTES || $part->size > self::MAX_MESSAGE_BYTES) {
            $this->logSkipped($owner, $summary->uid, 'too_large');

            return;
        }
        if ($part->method !== '' && $part->method !== 'REPLY') {
            $this->logSkipped($owner, $summary->uid, ImipReplyIngest::METHOD_NOT_SUPPORTED);

            return;
        }
        try {
            $raw = $client->section($summary->uid, $part->section);
        } catch (ImapException $exception) {
            if ($exception->errorCode !== ImapException::PROTOCOL_ERROR) {
                throw $exception;
            }
            $raw = null;
        }
        $ics = $raw !== null ? MimePartDecoder::decode($raw, $part->encoding, $part->charset) : null;
        if ($ics === null || strlen($ics) > VObjectPayloadGuard::MAX_ICS_BYTES) {
            $this->logSkipped($owner, $summary->uid, ImipReplyIngest::INVALID_CALENDAR);

            return;
        }
        try {
            $this->ingest->ingest($owner, (string) $mailbox->trusted_server_id, $summary->headers, $ics, $summary->uid);
        } catch (\Throwable $exception) {
            Log::error(self::LOG_FAILED, [
                'owner' => $owner,
                'imap_uid' => $summary->uid,
                'exception' => $exception::class,
            ]);
        }
    }

    /**
     * The authserv-id of the topmost Authentication-Results header, when the
     * newest messages that carry one all agree on it.
     */
    private function learnTrustedServerId(ImapClient $client, int $highest): string
    {
        if ($highest === 0) {
            return '';
        }
        $uids = array_slice($client->uidsAfter(max(0, $highest - 500)), -self::LEARN_SAMPLE);
        $ids = [];
        foreach ($client->summaries($uids) as $summary) {
            $top = $summary->headers->first('authentication-results');
            $parsed = $top !== null ? AuthenticationResults::parse($top) : null;
            if ($parsed !== null) {
                $ids[$parsed->serverId] = true;
            }
        }

        return count($ids) === 1 ? (string) array_key_first($ids) : '';
    }

    private function recordFailure(CalendarReplyMailbox $mailbox, ImapException $exception, int $now): void
    {
        $mailbox->last_error_code = $exception->errorCode;
        $mailbox->last_error_at = $now;
        if ($exception->errorCode === ImapException::AUTH_FAILED) {
            $mailbox->auth_failures = (int) $mailbox->auth_failures + 1;
            if ($mailbox->auth_failures >= self::AUTH_FAILURE_PAUSE) {
                $mailbox->enabled = false;
            }
        }
        Log::warning(self::LOG_FAILED, [
            'owner' => (string) $mailbox->username,
            'code' => $exception->errorCode,
        ]);
    }

    private function logSkipped(string $owner, int $imapUid, string $reason): void
    {
        Log::notice(ImipReplyIngest::LOG_SKIPPED, [
            'owner' => $owner,
            'imap_uid' => $imapUid,
            'uid' => '',
            'reason' => $reason,
        ]);
    }

    private function client(): ImapClient
    {
        return new ImapClient($this->container->make(ImapTransport::class));
    }
}
