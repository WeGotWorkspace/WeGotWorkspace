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
 * natively without our `Authorization` header. A selection ticket (#1905)
 * is bound to a list of node ids (files and folders) and zips them under
 * one top folder.
 *
 * Same rules as DownloadTicketService: a 256-bit secret stored as sha256;
 * bound to one account and the refresh-token family (sign-in session) that
 * issued it; expiry `min(lastSeen + idle, issued + lifetime)` from the same
 * config, touched at each request and about every 30 s while the zip
 * streams. Every request re-checks the session, that the account is
 * enabled, and that the folder is still a live, readable Drive folder, so a
 * withdrawn share stops the next request. For a selection, each item is
 * re-checked; items no longer readable are left out, and a selection with
 * none left is refused.
 */
final class FolderDownloadTicketService
{
    /** Most node ids one selection ticket may hold. */
    public const MAX_SELECTION = 1000;

    /** Longest zip name stem for a selection, in characters. */
    public const MAX_NAME_LENGTH = 120;

    /** Zip name stem for a selection that names no place. */
    public const DEFAULT_SELECTION_NAME = 'Download';

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
        $sid = $this->sessionFamily($principal);
        $username = $principal['username'];
        $folder = $this->readableFolder($username, $nodeId);
        if ($folder === null) {
            throw new ApiHttpException(404, 'Folder not found.', 'not_found');
        }

        return $this->store($username, $sid, $nodeId, null, FolderZipWalker::safeName((string) $folder->name).'.zip');
    }

    /**
     * A ticket for several items as one zip (#1905). Every item must be a
     * live, visible Drive file or folder the account may read; otherwise the
     * whole request is a 404, which does not say which id exists.
     *
     * @param  array{username: string, role: string, sid?: string}  $principal
     * @param  non-empty-list<string>  $nodeIds  distinct FileNode ids
     * @return array{url: string, name: string, idleExpires: string, absoluteExpires: string}
     */
    public function issueSelection(array $principal, array $nodeIds, ?string $name): array
    {
        $sid = $this->sessionFamily($principal);
        $username = $principal['username'];
        foreach ($nodeIds as $nodeId) {
            if ($this->readableItem($username, $nodeId) === null) {
                throw new ApiHttpException(404, 'Item not found.', 'not_found');
            }
        }

        return $this->store($username, $sid, $nodeIds[0], $nodeIds, self::selectionName($name).'.zip');
    }

    /** The selection zip's top folder and name stem: the place the user named, made safe. */
    public static function selectionName(?string $name): string
    {
        $name = trim((string) $name);
        if ($name === '') {
            return self::DEFAULT_SELECTION_NAME;
        }

        return trim(mb_substr(FolderZipWalker::safeName($name), 0, self::MAX_NAME_LENGTH));
    }

    /**
     * @param  array{username: string, role: string, sid?: string}  $principal
     */
    private function sessionFamily(array $principal): string
    {
        $sid = $principal['sid'] ?? null;
        if (! is_string($sid) || $sid === '') {
            throw new ApiHttpException(
                403,
                'Download tickets need a session-bound access token; refresh the token and retry.',
                'session_required',
            );
        }

        return $sid;
    }

    /**
     * @param  list<string>|null  $nodeIds
     * @return array{url: string, name: string, idleExpires: string, absoluteExpires: string}
     */
    private function store(string $username, string $sid, string $nodeId, ?array $nodeIds, string $name): array
    {
        $this->expiry->pruneExpired(DriveFolderDownloadTicket::query());

        $secret = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = Carbon::now();
        $ticket = DriveFolderDownloadTicket::query()->create([
            'secret_hash' => DownloadTicketService::hashSecret($secret),
            'username' => $username,
            'node_id' => $nodeId,
            'node_ids' => $nodeIds,
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
     * The ticket with its folder, or with its selection's items, or null when
     * the ticket is unknown, expired, its session ended, the account is
     * disabled, or the folder (or every selected item) is gone or no longer
     * readable. Accepting moves lastSeen forward.
     *
     * @return array{ticket: DriveFolderDownloadTicket, folder: JmapFileNode|null, items: list<JmapFileNode>|null, principal: array{username: string, role: string}}|null
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
        $folder = null;
        $items = null;
        if (is_array($ticket->node_ids)) {
            $items = [];
            foreach ($ticket->node_ids as $nodeId) {
                $item = $this->readableItem($username, $nodeId);
                if ($item !== null) {
                    $items[] = $item;
                }
            }
            if ($items === []) {
                return null;
            }
        } else {
            $folder = $this->readableFolder($username, (string) $ticket->node_id);
            if ($folder === null) {
                return null;
            }
        }

        $this->touch($ticket);

        return ['ticket' => $ticket, 'folder' => $folder, 'items' => $items, 'principal' => $this->accounts->principalFor($username)];
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

    /**
     * A live, visible Drive file or folder (not trash, notes, attachments, or
     * a name starting with `.`) the account may read: a selection item.
     */
    private function readableItem(string $username, string $nodeId): ?JmapFileNode
    {
        $node = $this->index->liveByNodeId($nodeId);
        if ($node === null || str_starts_with((string) $node->name, '.')) {
            return null;
        }
        $key = (string) $node->storage_key;
        if (StorageKeyClass::classify($key) !== StorageKeyClass::Regular) {
            return null;
        }

        return $this->reads->mayRead($key, $this->accounts->principalFor($username)) ? $node : null;
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
