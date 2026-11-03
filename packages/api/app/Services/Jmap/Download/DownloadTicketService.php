<?php

declare(strict_types=1);

namespace App\Services\Jmap\Download;

use App\Exceptions\ApiHttpException;
use App\Models\JmapDownloadTicket;
use App\Services\Auth\RefreshTokenRepository;
use App\Services\Auth\UserEnabledGuard;
use App\Services\Jmap\Blobs\BlobContent;
use App\Services\Jmap\Blobs\JmapDownloadBlobResolver;
use Illuminate\Support\Carbon;

/**
 * Download tickets (#1500): a native browser download cannot send our
 * `Authorization` header, so the client asks for a ticket for one blobId
 * and hands the browser its URL.
 *
 *  - The secret is 256 bits from random_bytes(), stored only as sha256.
 *  - A ticket is bound to one blobId, one account, and the refresh-token
 *    family (sign-in session) that issued it. Ending that session —
 *    sign-out, a revoked device, a password change — ends its tickets.
 *  - Expiry slides: `min(lastSeen + idle, issued + lifetime)`. lastSeen moves
 *    at each request start, about every 30 s while a body streams, and when
 *    the body ends — so probes, retries, and Range resumes work, a slow
 *    download that keeps progressing never expires mid-response, and an
 *    abandoned or leaked URL dies.
 *  - Every request resolves the blob for the bound account through the same
 *    resolvers as the authenticated route (including FileNode `mayRead`), so
 *    a withdrawn share or a disabled account stops the next request.
 *
 * Because a real blobId carries the content hash, a ticket never serves
 * other bytes than it was issued for. Documented exception: a hash-pending
 * node's id carries a provisional size/mtime version, so an out-of-band
 * rewrite that keeps both can be served under the same ticket.
 */
final class DownloadTicketService
{
    /** Seconds between lastSeen updates while a response streams. */
    public const TOUCH_INTERVAL_SECONDS = 30;

    public const SECRET_PATTERN = '[A-Za-z0-9_-]{43}';

    public function __construct(
        private readonly JmapDownloadBlobResolver $blobs,
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly UserEnabledGuard $enabled,
    ) {}

    /**
     * @param  array{username: string, role: string, sid?: string}  $principal
     * @return array{url: string, idleExpires: string, absoluteExpires: string}
     */
    public function issue(array $principal, string $blobId, string $name, ?string $type): array
    {
        $sid = $principal['sid'] ?? null;
        if (! is_string($sid) || $sid === '') {
            throw new ApiHttpException(
                403,
                'Download tickets need a session-bound access token; refresh the token and retry.',
                'session_required',
            );
        }
        $username = $principal['username'];
        if ($this->blobs->resolve($username, $blobId) === null) {
            throw new ApiHttpException(404, 'Blob not found.', 'not_found');
        }

        $this->pruneExpired();

        $secret = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = Carbon::now();
        $ticket = JmapDownloadTicket::query()->create([
            'secret_hash' => self::hashSecret($secret),
            'username' => $username,
            'blob_id' => $blobId,
            'file_name' => $name,
            'media_type' => $type,
            'session_family' => $sid,
            'issued_at' => $now,
            'last_seen_at' => $now,
            'absolute_expires_at' => $now->copy()->addHours($this->lifetimeHours()),
        ]);

        return [
            'url' => url('/api/v1/jmap/download-ticket/'.$secret.'/'.rawurlencode($name)),
            'idleExpires' => $this->expiresAt($ticket)->toIso8601ZuluString(),
            'absoluteExpires' => $ticket->absolute_expires_at->toIso8601ZuluString(),
        ];
    }

    /**
     * Resolves a ticket request, or null when the ticket is unknown, expired,
     * its session ended, the account is disabled, or the blob is no longer
     * readable by the bound account. Accepting moves lastSeen forward.
     *
     * @return array{ticket: JmapDownloadTicket, blob: BlobContent}|null
     */
    public function redeem(string $secret): ?array
    {
        if (preg_match('/^'.self::SECRET_PATTERN.'$/', $secret) !== 1) {
            return null;
        }
        $ticket = JmapDownloadTicket::query()->where('secret_hash', self::hashSecret($secret))->first();
        if ($ticket === null) {
            return null;
        }
        if (! Carbon::now()->lessThan($this->expiresAt($ticket))) {
            $ticket->delete();

            return null;
        }
        $username = (string) $ticket->username;
        if (! $this->refreshTokens->isFamilyLive($username, (string) $ticket->session_family)
            || ! $this->enabled->isEnabled($username)) {
            $ticket->delete();

            return null;
        }
        $blob = $this->blobs->resolve($username, (string) $ticket->blob_id);
        if ($blob === null) {
            return null;
        }

        $this->touch($ticket);

        return ['ticket' => $ticket, 'blob' => $blob];
    }

    /**
     * Activity hook for RangeResponder: touches lastSeen at most every
     * TOUCH_INTERVAL_SECONDS while the body streams, and once at the end.
     *
     * @return callable(bool): void
     */
    public function streamingActivity(JmapDownloadTicket $ticket): callable
    {
        $last = Carbon::now()->getTimestamp();

        return function (bool $done) use ($ticket, &$last): void {
            $now = Carbon::now()->getTimestamp();
            if (! $done && $now - $last < self::TOUCH_INTERVAL_SECONDS) {
                return;
            }
            $last = $now;
            $this->touch($ticket);
        };
    }

    public function expiresAt(JmapDownloadTicket $ticket): Carbon
    {
        $idle = $ticket->last_seen_at->copy()->addMinutes($this->idleMinutes());

        return $idle->lessThan($ticket->absolute_expires_at) ? $idle : $ticket->absolute_expires_at->copy();
    }

    public function pruneExpired(): int
    {
        $now = Carbon::now();

        return JmapDownloadTicket::query()
            ->where(function ($query) use ($now): void {
                $query->where('absolute_expires_at', '<=', $now)
                    ->orWhere('last_seen_at', '<=', $now->copy()->subMinutes($this->idleMinutes()));
            })
            ->delete();
    }

    public static function hashSecret(string $secret): string
    {
        return hash('sha256', $secret);
    }

    private function touch(JmapDownloadTicket $ticket): void
    {
        $now = Carbon::now();
        JmapDownloadTicket::query()->whereKey($ticket->getKey())->update(['last_seen_at' => $now]);
        $ticket->last_seen_at = $now;
    }

    private function idleMinutes(): int
    {
        return max(1, (int) config('wgw.jmap.download_ticket_idle_minutes', 30));
    }

    private function lifetimeHours(): int
    {
        return max(1, (int) config('wgw.jmap.download_ticket_lifetime_hours', 24));
    }
}
