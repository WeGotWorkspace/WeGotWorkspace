<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notes;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\NotebookCreateRequest;
use App\Http\Requests\Api\V1\NotebookDeleteRequest;
use App\Http\Requests\Api\V1\NotebookPatchRequest;
use App\Services\Notes\NotebookRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class NotebooksController
{
    public function __construct(private readonly NotebookRepository $notebooks) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notebooks->list($principal['username']));
    }

    public function show(Request $request, string $notebookId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notebooks->show($principal['username'], $notebookId));
    }

    public function store(NotebookCreateRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notebooks->create($principal['username'], $request->validated()), 201);
    }

    public function update(NotebookPatchRequest $request, string $notebookId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->notebooks->update($principal['username'], $notebookId, $request->validated()));
    }

    public function destroy(NotebookDeleteRequest $request, string $notebookId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $options = $request->validated();
        $queryFlag = $request->query('onDestroyRemoveContents');
        if ($queryFlag === '1' || $queryFlag === 'true' || $queryFlag === true) {
            $options['onDestroyRemoveContents'] = true;
        }

        return response()->json($this->notebooks->delete($principal['username'], $notebookId, $options));
    }

    public function changes(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $since = $request->query('since');

        return response()->json($this->notebooks->changes($principal['username'], is_string($since) ? $since : null));
    }
}
