<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Collab\CollabJoinAuthorizer;
use App\Services\Collab\CollabResponseException;
use App\Services\Collab\CollabRoomPolicy;
use App\Services\Collab\DocCollabDocumentService;
use App\Services\Collab\FramedPayload;
use App\Services\Drive\DriveAccessDeniedException;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveNotFoundException;
use App\Services\Drive\DriveService;
use App\Services\Rtc\RoomIdCodec;
use App\Storage\StoragePaths;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class FilesController
{
    /** On `?format=yjs&fallback=markdown`: the body is the markdown because there is no sidecar. */
    public const COLLAB_FALLBACK_HEADER = 'X-Wgw-Collab-Fallback';

    public function __construct(
        private DriveService $drive,
        private DriveGroupResolver $groups,
        private RoomIdCodec $roomIds,
        private DocCollabDocumentService $collabDocuments,
        private StoragePaths $paths,
        private CollabRoomPolicy $collabRooms,
        private CollabJoinAuthorizer $collabJoins,
    ) {}

    public function context(Request $request): JsonResponse
    {
        $principal = $this->principal($request);

        return $this->jsonData(fn () => $this->drive->userContext($principal['username']));
    }

    public function children(Request $request): JsonResponse
    {
        $path = $this->requireDrivePath($request);
        $principal = $this->principal($request);

        return $this->jsonData(fn () => $this->drive->listDirectory($principal, $path));
    }

    public function index(Request $request): JsonResponse
    {
        $principal = $this->principal($request);
        if ($request->query('search') === null) {
            throw new ApiHttpException(400, 'Missing search query parameter.', 'bad_request');
        }

        return $this->jsonData(fn () => $this->drive->search(
            $principal['username'],
            (string) $request->query('search', ''),
            max(1, min(100, (int) $request->query('limit', 50))),
        ));
    }

    public function content(Request $request): Response
    {
        $nodeId = $this->queryNodeId($request);
        if ($request->isMethod('HEAD')) {
            if ($nodeId !== null) {
                return $this->headContentByNodeId($request, $nodeId);
            }
            $path = $request->query('path');
            if (is_string($path) && trim($path) !== '') {
                return $this->headContent($request);
            }

            return $this->uploadProbe();
        }

        if ($nodeId !== null) {
            return $this->downloadByNodeId($request, $nodeId);
        }

        return $this->download($request);
    }

    private function headContentByNodeId(Request $request, string $nodeId): Response
    {
        try {
            $this->drive->assertReadableNodeId($this->principal($request), $nodeId);

            return response('', 200);
        } catch (\InvalidArgumentException|\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
    }

    private function downloadByNodeId(Request $request, string $nodeId): Response
    {
        try {
            $this->drive->assertFilesEnabled();

            return $this->drive->downloadResponseByNodeId(
                $this->principal($request),
                $nodeId,
                $request,
            );
        } catch (\InvalidArgumentException|\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
    }

    public function headContent(Request $request): Response
    {
        return $this->driveCall(function () use ($request): Response {
            $this->drive->assertReadableFile($this->principal($request), $this->requireDrivePath($request));

            return response('', 200);
        });
    }

    public function download(Request $request): Response
    {
        return $this->driveCall(function () use ($request): Response {
            $this->drive->assertFilesEnabled();

            return $this->drive->downloadResponse(
                $this->principal($request),
                $this->requireDrivePath($request),
                $request,
            );
        });
    }

    public function uploadProbe(): Response
    {
        try {
            $this->drive->assertFilesEnabled();

            return response('OK', 200)->header('Content-Type', 'text/plain; charset=utf-8');
        } catch (\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
    }

    public function showCollaboration(Request $request): Response
    {
        $path = $this->requirePath($request);
        $request->query->set('room', $path);

        if ($request->query('format') === 'yjs') {
            $snapshot = $this->collabDocuments->getYjsSnapshot($request, $path);
            // C7: a 204 means "no sidecar" and carries no entity tag.
            if ($snapshot === null) {
                if ($request->query('fallback') !== 'markdown') {
                    return response('', 204);
                }

                // Opt-in: "no sidecar" plus the markdown in one response, marked so a
                // client never mistakes it for sidecar bytes.
                $response = $this->collaborationBody(
                    $request,
                    $this->collabDocuments->getMarkdown($request, $path),
                    'text/markdown; charset=utf-8',
                );
                $response->headers->set(self::COLLAB_FALLBACK_HEADER, 'markdown');

                return $response;
            }

            return $this->collaborationBody(
                $request,
                $snapshot['bytes'],
                'application/octet-stream',
                $snapshot['externalWrite'],
            );
        }

        return $this->collaborationBody(
            $request,
            $this->collabDocuments->getMarkdown($request, $path),
            'text/markdown; charset=utf-8',
        );
    }

    /** 304 when `If-None-Match` still names this body. `*` matches any stored representation. */
    private function collaborationBody(
        Request $request,
        string $bytes,
        string $contentType,
        bool $externalWrite = false,
    ): Response {
        $etag = DocCollabDocumentService::sidecarEtag($bytes);
        $headers = [
            'Content-Type' => $contentType,
            'ETag' => $etag,
        ];
        if ($externalWrite) {
            // A 304 would hide the signal. The sidecar bytes are unchanged, and
            // the client must still see that they are not an ancestor.
            $headers[CollabExternalWrite::HEADER] = '1';

            return response($bytes, 200, $headers);
        }

        $ifNoneMatch = trim((string) $request->headers->get('If-None-Match', ''));
        if ($ifNoneMatch === '*' || $this->etagListed($ifNoneMatch, $etag)) {
            return response('', 304, ['ETag' => $etag]);
        }

        return response($bytes, 200, $headers);
    }

    private function etagListed(string $header, string $etag): bool
    {
        if ($header === '') {
            return false;
        }

        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                $candidate = trim(substr($candidate, 2));
            }
            if ($candidate === $etag) {
                return true;
            }
        }

        return false;
    }

    public function updateCollaboration(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);
        $result = $this->collabDocuments->put($request, $this->collaborationPayload($request, $path));
        $etag = $result['etag'];
        $response = response()->json(['ok' => $result['ok']]);

        return $etag === null ? $response : $response->header('ETag', $etag);
    }

    /**
     * The path query is the document. The body is the shared collaboration frame.
     *
     * A frame that does not parse is an HTTP 400: `error` is a sentence and
     * `code` is `invalid_body`, the same envelope as a missing path. Domain
     * refusals from `put()` stay `{error: code}` (`nothing_to_save`, `yjs_too_large`).
     *
     * @return array<string, mixed>
     */
    private function collaborationPayload(Request $request, string $path): array
    {
        $payload = FramedPayload::collaborationFields($request->getContent());
        $payload['room'] = $path;

        return $payload;
    }

    public function star(Request $request): JsonResponse
    {
        $path = $this->requireDrivePath($request);

        return $this->jsonData(fn () => $this->drive->updateStar(
            $this->username($request),
            $path,
            true,
        ));
    }

    public function unstar(Request $request): JsonResponse
    {
        $path = $this->requireDrivePath($request);

        return $this->jsonData(fn () => $this->drive->updateStar(
            $this->username($request),
            $path,
            false,
        ));
    }

    public function starred(Request $request): JsonResponse
    {
        $username = $this->principal($request)['username'];
        $groupSlugs = $this->groups->allowedGroupSlugs($username);

        return $this->jsonData(fn () => [
            'paths' => $this->drive->listStarredPaths($username, $groupSlugs),
        ]);
    }

    /**
     * The room id is handed out only to a caller who may join the room: the
     * same room check and read check as the join itself. Anything else is a
     * plain 404, the same answer as for a path that does not exist.
     */
    public function resolveRoom(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);
        try {
            $this->collabJoins->assertMayJoin($this->collabRooms->cleanRoom($path), $this->principal($request));
        } catch (CollabResponseException) {
            throw new ApiHttpException(404, 'File not found.', 'not_found');
        }

        return response()->json([
            'roomId' => $this->roomIds->encodeFilePath($path),
            'path' => $path,
        ]);
    }

    /**
     * @param  callable(): mixed  $callback
     */
    private function jsonData(callable $callback): JsonResponse
    {
        return $this->driveCall(fn (): JsonResponse => response()->json(['data' => $callback()]));
    }

    /**
     * Run a drive call and map its errors: a refused or missing path is 404, other invalid
     * input is 400.
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    private function driveCall(callable $callback): mixed
    {
        try {
            return $callback();
        } catch (DriveAccessDeniedException|DriveNotFoundException $e) {
            throw $this->notFound($e);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        } catch (\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
    }

    private function requirePath(Request $request): string
    {
        $path = $request->query('path');
        if (! is_string($path) || trim($path) === '') {
            throw new ApiHttpException(400, 'Missing path query parameter.', 'bad_request');
        }

        return $path;
    }

    /**
     * A drive path for children, content and star. A `..` segment is answered as not found:
     * it never resolves to a path outside the one the caller asked for.
     */
    private function requireDrivePath(Request $request): string
    {
        $path = $this->requirePath($request);
        if ($this->paths->hasParentSegment($path)) {
            throw new ApiHttpException(404, 'Path not found.', 'not_found');
        }

        return $path;
    }

    /**
     * A refused path reads as a missing one: 404 `not_found`, with no hint whether
     * something exists where the caller may not look.
     */
    private function notFound(DriveAccessDeniedException|DriveNotFoundException $e): ApiHttpException
    {
        $message = $e instanceof DriveAccessDeniedException ? 'Path not found.' : $e->getMessage();

        return new ApiHttpException(404, $message, 'not_found');
    }

    private function queryNodeId(Request $request): ?string
    {
        $id = $request->query('id');
        if (! is_string($id) || trim($id) === '') {
            return null;
        }

        return trim($id);
    }

    private function username(Request $request): string
    {
        return $this->principal($request)['username'];
    }

    /**
     * @return array{username: string, role: string}
     */
    private function principal(Request $request): array
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal;
    }
}
