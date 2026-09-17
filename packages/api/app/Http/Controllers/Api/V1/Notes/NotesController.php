<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notes;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\NoteCreateRequest;
use App\Http\Requests\Api\V1\NotePatchRequest;
use App\Http\Support\JmapResourceResponse;
use App\Services\Notes\NoteRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class NotesController
{
    public function __construct(private readonly NoteRepository $notes) {}

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

    public function show(Request $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

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

    public function patch(NotePatchRequest $request, string $noteId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->notes->patch(
                $principal['username'],
                $noteId,
                $request->validated(),
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

    private function header(Request $request, string $name): ?string
    {
        $value = $request->header($name);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
