<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notes;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\NoteCollaborativePutRequest;
use App\Http\Requests\Api\V1\NoteCreateRequest;
use App\Http\Requests\Api\V1\NotePatchRequest;
use App\Http\Support\JmapResourceResponse;
use App\Http\Support\OptimisticConcurrency;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Notes\NoteCollaborativeWrite;
use App\Services\Notes\NoteRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class NotesController
{
    public function __construct(
        private readonly NoteRepository $notes,
        private readonly NoteCollaborativeWrite $collaboration,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $notebookId = $request->query('notebookId');
        $starred = $request->query('starred');
        $status = $request->query('status');

        return response()->json($this->notes->list(
            $principal['username'],
            is_string($notebookId) ? $notebookId : null,
            filter_var($starred, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE),
            is_string($status) ? $status : null,
        ));
    }

    public function show(Request $request, string $noteId): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if ($request->query('format') === 'yjs') {
            return $this->yjsState($request, $principal['username'], $noteId);
        }

        return JmapResourceResponse::json($this->notes->show($principal['username'], $noteId));
    }

    public function store(NoteCreateRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->notes->create($principal['username'], $request->validated()),
            201,
        );
    }

    public function putCollaboration(NoteCollaborativePutRequest $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();
        $body = [
            'markdown' => $validated['markdown'],
            'yjs' => $request->yjsBytes(),
        ];
        if (array_key_exists('title', $validated)) {
            $body['title'] = $validated['title'];
        }

        $etag = $this->collaboration->put(
            $principal['username'],
            $noteId,
            $body,
            $this->header($request, 'If-Match'),
            $this->header($request, 'If-None-Match'),
        );

        return response()->json(['ok' => true])->header('ETag', $etag);
    }

    public function patch(NotePatchRequest $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $patch = $request->validated();
        $yjs = $request->attributes->get(NotePatchRequest::YJS_BYTES);
        if (is_string($yjs)) {
            $patch['yjs'] = $yjs;
        }

        return JmapResourceResponse::json(
            $this->notes->patch(
                $principal['username'],
                $noteId,
                $patch,
                $this->header($request, 'If-Match'),
                $this->header($request, 'If-Unmodified-Since'),
            )
        );
    }

    public function destroy(Request $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json(
            $this->notes->delete(
                $principal['username'],
                $noteId,
                $this->header($request, 'If-Match'),
                $this->header($request, 'If-Unmodified-Since'),
                // Match Note/set destroy: If-Match is optional. Field updates still require it.
                requirePrecondition: false,
            )
        );
    }

    public function star(Request $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notes->star($principal['username'], $noteId));
    }

    public function unstar(Request $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notes->unstar($principal['username'], $noteId));
    }

    public function changes(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $notebookId = $request->query('notebookId');
        if (! is_string($notebookId) || trim($notebookId) === '') {
            throw new ApiHttpException(400, 'notebookId is required.', 'bad_request');
        }
        $since = $request->query('since');

        return response()->json($this->notes->changes(
            $principal['username'],
            $notebookId,
            is_string($since) ? $since : null,
        ));
    }

    private function yjsState(Request $request, string $username, string $noteId): Response
    {
        $snapshot = $this->notes->yjsSnapshot($username, $noteId);
        if ($snapshot === null) {
            return response('', 204);
        }

        $headers = [
            'Content-Type' => 'application/octet-stream',
            'ETag' => $snapshot['etag'],
            'X-Content-Type-Options' => 'nosniff',
        ];
        if ($snapshot['externalWrite']) {
            // A 304 would hide the signal. The state bytes are unchanged, and
            // the client must still see that they are not an ancestor.
            $headers[CollabExternalWrite::HEADER] = '1';
        }

        $ifNoneMatch = trim((string) $request->headers->get('If-None-Match', ''));
        if (
            ! $snapshot['externalWrite']
            && $ifNoneMatch !== ''
            && OptimisticConcurrency::ifMatchSatisfied($ifNoneMatch, $snapshot['etag'])
        ) {
            return response('', 304, ['ETag' => $snapshot['etag']]);
        }

        return response($snapshot['bytes'], 200, $headers);
    }

    private function header(Request $request, string $name): ?string
    {
        $value = $request->header($name);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
