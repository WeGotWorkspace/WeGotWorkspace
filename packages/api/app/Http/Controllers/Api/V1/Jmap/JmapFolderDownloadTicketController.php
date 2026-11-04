<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\FolderZip\FolderDownloadTicketService;
use App\Services\Drive\FolderZip\FolderZipAborted;
use App\Services\Drive\FolderZip\FolderZipStreamer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Folder download tickets (#1621): `store` issues a ticket for one folder
 * node (`nodeId`), or for several selected items (`nodeIds`, #1905), on the
 * authenticated route; `show` streams them as a stored zip on an
 * unauthenticated URL the browser downloads natively. No `Range`: a dropped
 * zip download starts again.
 */
final class JmapFolderDownloadTicketController
{
    private const NODE_ID_PATTERN = '/^fn-[0-9a-f]{32}$/';

    public function __construct(
        private readonly FolderDownloadTicketService $tickets,
        private readonly FolderZipStreamer $zips,
    ) {}

    public function store(Request $request, string $accountId): JsonResponse
    {
        /** @var array{username: string, role: string, sid?: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if ($accountId !== $principal['username']) {
            throw new ApiHttpException(404, 'Account not found.', 'not_found');
        }
        $nodeId = $request->input('nodeId');
        $nodeIds = $request->input('nodeIds');
        if ($nodeIds !== null) {
            if ($nodeId !== null) {
                throw new ApiHttpException(400, 'Send nodeId or nodeIds, not both.', 'bad_request');
            }

            return response()->json(
                $this->tickets->issueSelection($principal, $this->selectionIds($nodeIds), $this->selectionName($request->input('name'))),
                201,
            );
        }
        if (! is_string($nodeId) || preg_match(self::NODE_ID_PATTERN, $nodeId) !== 1) {
            throw new ApiHttpException(400, 'nodeId must be a FileNode id.', 'bad_request');
        }

        return response()->json($this->tickets->issue($principal, $nodeId), 201);
    }

    /**
     * 1 to MAX_SELECTION FileNode ids; a repeated id counts once.
     *
     * @return non-empty-list<string>
     */
    private function selectionIds(mixed $nodeIds): array
    {
        if (! is_array($nodeIds) || ! array_is_list($nodeIds) || $nodeIds === []
            || count($nodeIds) > FolderDownloadTicketService::MAX_SELECTION) {
            throw new ApiHttpException(
                400,
                'nodeIds must be a list of 1 to '.FolderDownloadTicketService::MAX_SELECTION.' FileNode ids.',
                'bad_request',
            );
        }
        $ids = [];
        foreach ($nodeIds as $id) {
            if (! is_string($id) || preg_match(self::NODE_ID_PATTERN, $id) !== 1) {
                throw new ApiHttpException(400, 'nodeIds must be FileNode ids.', 'bad_request');
            }
            $ids[$id] = true;
        }

        return array_keys($ids);
    }

    private function selectionName(mixed $name): ?string
    {
        if ($name !== null && ! is_string($name)) {
            throw new ApiHttpException(400, 'name must be a string.', 'bad_request');
        }

        return $name;
    }

    public function show(string $secret, string $name): Response
    {
        $redeemed = $this->tickets->redeem($secret);
        if ($redeemed === null) {
            return response()
                ->json(['type' => 'about:blank', 'status' => 404, 'detail' => 'Download ticket not found or expired.'], 404)
                ->header('Content-Type', 'application/problem+json');
        }
        $ticket = $redeemed['ticket'];
        $zipName = (string) $ticket->zip_name;
        $activity = $this->tickets->streamingActivity($ticket);

        return new StreamedResponse(function () use ($redeemed, $activity, $zipName): void {
            if (function_exists('set_time_limit')) {
                @set_time_limit(0);
            }
            $sink = static function (string $bytes): void {
                if (connection_aborted() === 1) {
                    throw new FolderZipAborted;
                }
                echo $bytes;
                // The front controller's buffer flushes itself every 64 KiB; pass
                // the bytes on now, so the browser sees the download start before
                // a large file's CRC pass. A capturing buffer (no chunk size) keeps them.
                $buffer = ob_get_status();
                if ($buffer === [] || (int) ($buffer['chunk_size'] ?? 0) > 0) {
                    if ($buffer !== []) {
                        ob_flush();
                    }
                    flush();
                }
            };
            try {
                if ($redeemed['items'] !== null) {
                    $top = substr($zipName, 0, -strlen('.zip'));
                    $this->zips->streamSelection($top, $redeemed['items'], $redeemed['principal'], $sink, $activity);
                } elseif ($redeemed['folder'] !== null) {
                    $this->zips->stream($redeemed['folder'], $redeemed['principal'], $sink, $activity);
                }
            } catch (FolderZipAborted) {
                // The browser went away: stop walking and reading.
            }
        }, 200, [
            'Content-Type' => 'application/zip',
            'Content-Disposition' => $this->disposition($zipName),
            'Cache-Control' => 'private, no-store',
            'Accept-Ranges' => 'none',
            'X-Accel-Buffering' => 'no',
            // An unauthenticated URL on our origin: never let it render.
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "sandbox; default-src 'none'",
        ]);
    }

    /** RFC 6266: an ASCII fallback plus the UTF-8 name. */
    private function disposition(string $name): string
    {
        $ascii = (string) preg_replace('/[^\x20-\x7e]|["\\\\]/u', '_', $name);

        return 'attachment; filename="'.$ascii.'"; filename*=UTF-8\'\''.rawurlencode($name);
    }
}
