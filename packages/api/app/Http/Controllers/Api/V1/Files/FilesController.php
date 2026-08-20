<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Collab\DocCollabDocumentService;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveService;
use App\Services\Rtc\RoomIdCodec;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class FilesController
{
    public function __construct(
        private DriveService $drive,
        private DriveGroupResolver $groups,
        private RoomIdCodec $roomIds,
        private DocCollabDocumentService $collabDocuments,
    ) {}

    public function context(Request $request): JsonResponse
    {
        $principal = $this->principal($request);

        return $this->jsonData(fn () => $this->drive->userContext($principal['username']));
    }

    public function children(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);
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
        if ($request->isMethod('HEAD')) {
            $path = $request->query('path');
            if (is_string($path) && trim($path) !== '') {
                return $this->headContent($request);
            }

            return $this->uploadProbe();
        }

        return $this->download($request);
    }

    public function headContent(Request $request): Response
    {
        try {
            $this->drive->assertReadableFile($this->principal($request), $this->requirePath($request));

            return response('', 200);
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        } catch (\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
    }

    public function download(Request $request): Response
    {
        try {
            $this->drive->assertFilesEnabled();

            return $this->drive->downloadResponse(
                $this->principal($request),
                $this->requirePath($request),
            );
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        } catch (\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }
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
            $binary = $this->collabDocuments->getYjsBinary($request, $path);
            if ($binary === null) {
                return response('', 204);
            }

            return response($binary, 200, [
                'Content-Type' => 'application/octet-stream',
            ]);
        }

        return response(
            $this->collabDocuments->getMarkdown($request, $path),
            200,
            ['Content-Type' => 'text/markdown; charset=utf-8'],
        );
    }

    public function updateCollaboration(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);
        $payload = $request->json()->all();
        if (! is_array($payload)) {
            $payload = [];
        }
        $payload['room'] = $path;
        $request->json()->replace($payload);

        return response()->json($this->collabDocuments->put($request, $payload));
    }

    public function star(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);

        return $this->jsonData(fn () => $this->drive->updateStar(
            $this->username($request),
            $path,
            true,
        ));
    }

    public function unstar(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);

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

    public function resolveRoom(Request $request): JsonResponse
    {
        $path = $this->requirePath($request);

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
        try {
            return response()->json(['data' => $callback()]);
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
