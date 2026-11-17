<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Models\CalendarReplyMailbox;
use App\Services\Calendars\Imip\Dkim\DkimResult;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Contracts\Cache\Repository;
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
 *   block the box. The one exception is a reply whose DKIM key lookup
 *   failed: the poll stops before it and the next poll tries again, so
 *   replies keep their arrival order. The mailbox waits at most
 *   {@see DNS_RETRY_SECONDS} in total, counted from the first such failure;
 *   after that, deferred messages are skipped at once.
 * - Senders are checked by {@see ImipSenderVerifier}: the trusted receiving
 *   server's Authentication-Results when one is known, DKIM otherwise.
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

    /** How long a reply whose DKIM key lookup keeps failing is retried before it is skipped. */
    public const DNS_RETRY_SECONDS = 3600;

    /** Last error while the poll waits on a failed DKIM key lookup. */
    public const DNS_UNAVAILABLE = 'dns_unavailable';

    public const LOG_FAILED = 'calendar.imip_poll_failed';

    public const LOG_DEFERRED = 'calendar.imip_reply_deferred';

    private const DEFER_PREFIX = 'calendar-imip-dkim-defer:';

    public function __construct(
        private readonly Container $container,
        private readonly ImipEndpointResolver $endpoints,
        private readonly ImipMailboxSettings $settings,
        private readonly ImipReplyIngest $ingest,
        private readonly ImipSenderVerifier $senders,
        private readonly Repository $cache,
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
            $error = $this->read($client, $mailbox, $state['uidvalidity'], $highest, $now);
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

    /**
     * Reads new UIDs; returns an error code to show, or null. Without a
     * trusted server id, senders are checked by DKIM. Only the connection
     * test learns the id: a poll that learned it from the mail it is about
     * to apply could be taught by a forgery.
     */
    private function read(ImapClient $client, CalendarReplyMailbox $mailbox, int $uidValidity, int $highest, int $now): ?string
    {
        if ($mailbox->uidvalidity !== $uidValidity || $mailbox->last_uid === null) {
            $mailbox->uidvalidity = $uidValidity;
            $mailbox->last_uid = $highest;
        }

        $pending = $client->uidsAfter((int) $mailbox->last_uid);
        $uids = array_slice($pending, 0, self::BATCH_SIZE);
        $summaries = $client->summaries($uids);
        foreach ($uids as $uid) {
            $summary = $summaries[$uid] ?? null;
            if ($summary !== null && ! $this->readMessage($client, $mailbox, $summary, $now)) {
                return self::DNS_UNAVAILABLE;
            }
            $mailbox->last_uid = $uid;
        }
        if (count($pending) <= self::BATCH_SIZE) {
            $this->cache->forget($this->deferKey($mailbox));
        }

        return null;
    }

    /** False when the message must be read again on the next poll. */
    private function readMessage(ImapClient $client, CalendarReplyMailbox $mailbox, ImapMessageSummary $summary, int $now): bool
    {
        $part = $summary->calendarPart;
        if ($part === null) {
            return true;
        }
        $owner = (string) $mailbox->username;
        if ($summary->size > self::MAX_MESSAGE_BYTES || $part->size > self::MAX_MESSAGE_BYTES) {
            $this->logSkipped($owner, $summary->uid, 'too_large');

            return true;
        }
        if ($part->method !== '' && $part->method !== 'REPLY') {
            $this->logSkipped($owner, $summary->uid, ImipReplyIngest::METHOD_NOT_SUPPORTED);

            return true;
        }
        $sender = $this->senders->check(
            $owner,
            $summary->headers,
            (string) $mailbox->trusted_server_id,
            fn (): ?string => $this->wholeMessage($client, $summary->uid),
            $now,
        );
        if ($sender->retry) {
            if (! $this->retryExpired($mailbox, $now)) {
                Log::notice(self::LOG_DEFERRED, ['owner' => $owner, 'imap_uid' => $summary->uid]);

                return false;
            }
            $sender = ImipSenderCheck::refused(DkimResult::DNS_UNAVAILABLE, $sender->check);
        }
        if (! $sender->ok()) {
            $this->logSkipped($owner, $summary->uid, ImipReplyIngest::SENDER_NOT_VERIFIED, $sender);

            return true;
        }
        try {
            $raw = $client->section($summary->uid, $part->section);
        } catch (ImapException $exception) {
            if ($exception->errorCode !== ImapException::PROTOCOL_ERROR) {
                $this->senders->release($sender);

                throw $exception;
            }
            $raw = null;
        }
        if ($raw === null) {
            $this->senders->release($sender);
        }
        $ics = $raw !== null ? MimePartDecoder::decode($raw, $part->encoding, $part->charset) : null;
        if ($ics === null || strlen($ics) > VObjectPayloadGuard::MAX_ICS_BYTES) {
            $this->logSkipped($owner, $summary->uid, ImipReplyIngest::INVALID_CALENDAR, $sender);

            return true;
        }
        try {
            $this->ingest->ingest($owner, $sender, $ics, $summary->uid);
        } catch (\Throwable $exception) {
            $this->senders->release($sender);
            Log::error(self::LOG_FAILED, [
                'owner' => $owner,
                'imap_uid' => $summary->uid,
                'exception' => $exception::class,
            ]);
        }

        return true;
    }

    private function wholeMessage(ImapClient $client, int $uid): ?string
    {
        try {
            return $client->message($uid);
        } catch (ImapException $exception) {
            if ($exception->errorCode !== ImapException::PROTOCOL_ERROR) {
                throw $exception;
            }

            return null;
        }
    }

    /**
     * Whether the mailbox has waited long enough on failed key lookups. One
     * clock per mailbox, not per message: anyone can send a signed reply
     * whose key lookup fails, so each such message must not wait for itself.
     * The first deferral starts the clock; once it has run out, every
     * deferred message is skipped at once. A poll that ends without a
     * deferral and reached the end of the folder clears it.
     */
    private function retryExpired(CalendarReplyMailbox $mailbox, int $now): bool
    {
        $key = $this->deferKey($mailbox);
        $first = $this->cache->get($key);
        if (! is_int($first)) {
            $this->cache->forever($key, $now);

            return false;
        }

        return $now - $first >= self::DNS_RETRY_SECONDS;
    }

    private function deferKey(CalendarReplyMailbox $mailbox): string
    {
        return self::DEFER_PREFIX.hash('sha256', strtolower((string) $mailbox->username).'|'.(int) $mailbox->uidvalidity);
    }

    /**
     * The authserv-id of the topmost Authentication-Results header, when every
     * sampled message carries one and they all agree. A message without one
     * shows that the server does not stamp mail, so nothing can be trusted.
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
            if ($parsed === null) {
                return '';
            }
            $ids[$parsed->serverId] = true;
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

    private function logSkipped(string $owner, int $imapUid, string $reason, ?ImipSenderCheck $sender = null): void
    {
        Log::notice(ImipReplyIngest::LOG_SKIPPED, [
            'owner' => $owner,
            'imap_uid' => $imapUid,
            'uid' => '',
            'reason' => $reason,
            'check' => $sender?->check,
            'detail' => $sender?->reason,
        ]);
    }

    private function client(): ImapClient
    {
        return new ImapClient($this->container->make(ImapTransport::class));
    }
}
