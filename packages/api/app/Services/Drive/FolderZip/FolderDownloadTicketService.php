<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

use App\Exceptions\ApiHttpException;
use App\Models\DriveFolderDownloadTicket;
use App\Models\JmapFileNode;
use App\Services\Auth\RefreshTokenRepository;
use App\Services\Auth\UserEnabledGuard;
use App\Services\Jmap\Download\DownloadTicketService;
use App\Services\Jmap\Download\TicketExpiry;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StorageKeyClass;
use Illuminate\Support\Carbon;

/**
 * Folder download tickets (#1621): #1500's download ticket, bound to a
 * folder's node id instead of a blobId, so the browser can save the zip
 * natively without our `Authorization` header.
 *
 * Same rules as DownloadTicketService: a 256-bit secret stored as sha256;
 * bound to one account and the refresh-token family (sign-in session) that
 * issued it; expiry `min(lastSeen + idle, issued + lifetime)` from the same
 * config, touched at each request and about every 30 s while the zip
 * streams. Every request re-checks the session, that the account is
 * enabled, and that the folder is still a live, readable Drive folder, so a
 * withdrawn share stops the next request.
 */
final class FolderDownloadTicketService
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FolderZipReadCheck $reads,
        private readonly FileNodeAccountSupport $accounts,
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly UserEnabledGuard $enabled,
        private readonly TicketExpiry $expiry,
    ) {}

    /**
     * @param  array{username: string, role: string, sid?: string}  $principal
     * @return array{url: string, name: string, idleExpires: string, absoluteExpires: string}
     */
    public function issue(array $principal, string $nodeId): array
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
        $folder = $this->readableFolder($username, $nodeId);
        if ($folder === null) {
            throw new ApiHttpException(404, 'Folder not found.', 'not_found');
        }

        $this->expiry->pruneExpired(DriveFolderDownloadTicket::query());

        $name = FolderZipWalker::safeName((string) $folder->name).'.zip';
        $secret = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = Carbon::now();
        $ticket = DriveFolderDownloadTicket::query()->create([
            'secret_hash' => DownloadTicketService::hashSecret($secret),
            'username' => $username,
            'node_id' => $nodeId,
            'zip_name' => $name,
            'session_family' => $sid,
            'issued_at' => $now,
            'last_seen_at' => $now,
            'absolute_expires_at' => $this->expiry->absoluteExpiresFrom($now),
        ]);

        return [
            'url' => url('/api/v1/jmap/folder-download-ticket/'.$secret.'/'.rawurlencode($name)),
            'name' => $name,
            'idleExpires' => $this->expiry->expiresAt($ticket->last_seen_at, $ticket->absolute_expires_at)->toIso8601ZuluString(),
            'absoluteExpires' => $ticket->absolute_expires_at->toIso8601ZuluString(),
        ];
    }

    /**
     * The ticket and its folder, or null when the ticket is unknown, expired,
     * its session ended, the account is disabled, or the folder is gone or no
     * longer readable. Accepting moves lastSeen forward.
     *
     * @return array{ticket: DriveFolderDownloadTicket, folder: JmapFileNode, principal: array{username: string, role: string}}|null
     */
    public function redeem(string $secret): ?array
    {
        if (preg_match('/^'.DownloadTicketService::SECRET_PATTERN.'$/', $secret) !== 1) {
            return null;
        }
        $ticket = DriveFolderDownloadTicket::query()
            ->where('secret_hash', DownloadTicketService::hashSecret($secret))
            ->first();
        if ($ticket === null) {
            return null;
        }
        $username = (string) $ticket->username;
        if (! Carbon::now()->lessThan($this->expiry->expiresAt($ticket->last_seen_at, $ticket->absolute_expires_at))
            || ! $this->refreshTokens->isFamilyLive($username, (string) $ticket->session_family)
            || ! $this->enabled->isEnabled($username)) {
            $ticket->delete();

            return null;
        }
        $folder = $this->readableFolder($username, (string) $ticket->node_id);
        if ($folder === null) {
            return null;
        }

        $this->touch($ticket);

        return ['ticket' => $ticket, 'folder' => $folder, 'principal' => $this->accounts->principalFor($username)];
    }

    /**
     * Touches lastSeen at most every TOUCH_INTERVAL_SECONDS while the zip
     * streams, so a long download never expires mid-response.
     *
     * @return callable(): void
     */
    public function streamingActivity(DriveFolderDownloadTicket $ticket): callable
    {
        $last = Carbon::now()->getTimestamp();

        return function () use ($ticket, &$last): void {
            $now = Carbon::now()->getTimestamp();
            if ($now - $last < DownloadTicketService::TOUCH_INTERVAL_SECONDS) {
                return;
            }
            $last = $now;
            $this->touch($ticket);
        };
    }

    /** A live Drive folder (not trash, notes, or attachments) the account may read. */
    private function readableFolder(string $username, string $nodeId): ?JmapFileNode
    {
        $folder = $this->index->liveByNodeId($nodeId);
        if ($folder === null || ! $folder->is_dir) {
            return null;
        }
        $key = (string) $folder->storage_key;
        if (StorageKeyClass::classify($key) !== StorageKeyClass::Regular) {
            return null;
        }

        return $this->reads->mayRead($key, $this->accounts->principalFor($username)) ? $folder : null;
    }

    private function touch(DriveFolderDownloadTicket $ticket): void
    {
        $now = Carbon::now();
        DriveFolderDownloadTicket::query()->whereKey($ticket->getKey())->update(['last_seen_at' => $now]);
        $ticket->last_seen_at = $now;
    }
}
