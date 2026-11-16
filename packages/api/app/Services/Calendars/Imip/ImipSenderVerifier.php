<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Services\Calendars\Imip\Dkim\DkimMessage;
use App\Services\Calendars\Imip\Dkim\DkimResult;
use App\Services\Calendars\Imip\Dkim\DkimTagList;
use App\Services\Calendars\Imip\Dkim\DkimVerifier;
use Closure;
use Illuminate\Contracts\Cache\Repository;

/**
 * Decides whether a reply's From address is authenticated.
 *
 * - A mailbox with a trusted receiving server: that server's
 *   Authentication-Results header only ({@see ImipSenderAuthentication}).
 * - A mailbox without one: the message's own DKIM signature. A signature
 *   counts when its `d=` is the From domain or a parent of it, it verifies
 *   against the key in DNS, it was made in the last 72 hours, and this
 *   mailbox has not accepted the same signature before. A failed key lookup
 *   defers the message instead of deciding.
 */
class ImipSenderVerifier
{
    public const FRESH_SECONDS = 72 * 3600;

    public const CLOCK_SKEW_SECONDS = 900;

    public const REPLAY_TTL_SECONDS = self::FRESH_SECONDS + 3600;

    public const STALE = 'dkim_stale';

    public const REPLAYED = 'dkim_replayed';

    private const REPLAY_PREFIX = 'calendar-imip-dkim-seen:';

    public function __construct(
        private readonly ImipSenderAuthentication $receivingServer,
        private readonly DkimVerifier $dkim,
        private readonly Repository $cache,
    ) {}

    /**
     * @param  Closure(): ?string  $message  the whole message; only called when a DKIM check needs it
     */
    public function check(string $owner, MailHeaders $headers, string $trustedServerId, Closure $message, int $now): ImipSenderCheck
    {
        if (trim($trustedServerId) !== '') {
            return $this->receivingServer->check($headers, $trustedServerId);
        }

        return $this->checkDkim($owner, $headers, $message, $now);
    }

    /**
     * `d=` equal to the From domain, or a parent of it with at least two
     * labels. Not the other way round: without a public suffix list, a
     * subdomain signer could be a tenant of a shared hosting domain.
     */
    public static function aligned(string $signingDomain, string $fromDomain): bool
    {
        if ($signingDomain === '' || $fromDomain === '') {
            return false;
        }

        return $signingDomain === $fromDomain
            || (str_contains($signingDomain, '.') && str_ends_with($fromDomain, '.'.$signingDomain));
    }

    /**
     * @param  Closure(): ?string  $message
     */
    private function checkDkim(string $owner, MailHeaders $headers, Closure $message, int $now): ImipSenderCheck
    {
        $from = self::singleFrom($headers->all('from'));
        if ($from === null) {
            return ImipSenderCheck::refused(ImipSenderAuthentication::NO_SENDER, ImipSenderCheck::DKIM);
        }
        $fromDomain = $from->domain();
        $accept = static fn (string $domain): bool => self::aligned($domain, $fromDomain);
        if (! $this->hasAlignedSignature($headers->all('dkim-signature'), $accept)) {
            return ImipSenderCheck::refused(DkimResult::NO_SIGNATURE, ImipSenderCheck::DKIM);
        }

        $raw = $message();
        $parsed = $raw !== null ? DkimMessage::parse($raw) : null;
        if ($raw === null || $parsed === null) {
            return ImipSenderCheck::refused(DkimResult::MALFORMED, ImipSenderCheck::DKIM);
        }
        // The message that is verified must name the same, single sender.
        if (self::singleFrom($parsed->all('from'))?->email !== $from->email) {
            return ImipSenderCheck::refused(ImipSenderAuthentication::NO_SENDER, ImipSenderCheck::DKIM);
        }

        $result = $this->dkim->verify($raw, $accept, $now);
        if ($result->status === DkimResult::TEMPERROR) {
            return ImipSenderCheck::deferred($result->reason, ImipSenderCheck::DKIM);
        }
        if (! $result->passed()) {
            return ImipSenderCheck::refused($result->reason, ImipSenderCheck::DKIM);
        }
        $signedAt = $result->signedAt;
        if ($signedAt === null || $signedAt < $now - self::FRESH_SECONDS || $signedAt > $now + self::CLOCK_SKEW_SECONDS) {
            return ImipSenderCheck::refused(self::STALE, ImipSenderCheck::DKIM);
        }
        $seenKey = self::REPLAY_PREFIX.hash('sha256', strtolower($owner).'|'.$result->signatureId);
        if (! $this->cache->add($seenKey, $now, self::REPLAY_TTL_SECONDS)) {
            return ImipSenderCheck::refused(self::REPLAYED, ImipSenderCheck::DKIM);
        }

        return ImipSenderCheck::verified($from, ImipSenderCheck::DKIM, $seenKey);
    }

    /**
     * Forget the signature of a verified reply that was not handled (its
     * calendar part could not be read, or applying it failed), so a second
     * delivery of the same message is checked again.
     */
    public function release(ImipSenderCheck $check): void
    {
        if ($check->replayKey !== '') {
            $this->cache->forget($check->replayKey);
        }
    }

    /**
     * @param  list<string>  $values
     */
    private static function singleFrom(array $values): ?MailAddress
    {
        return count($values) === 1 ? MailAddress::fromHeader($values[0]) : null;
    }

    /**
     * Whether any signature in the fetched header fields could count, so a
     * message without one is refused before its body is downloaded.
     *
     * @param  list<string>  $signatures
     * @param  Closure(string): bool  $accept
     */
    private function hasAlignedSignature(array $signatures, Closure $accept): bool
    {
        foreach (array_slice($signatures, 0, DkimVerifier::MAX_SIGNATURES) as $value) {
            $tags = DkimTagList::parse($value);
            $domain = rtrim(strtolower(DkimTagList::compact($tags['d'] ?? '')), '.');
            if ($accept($domain)) {
                return true;
            }
        }

        return false;
    }
}
