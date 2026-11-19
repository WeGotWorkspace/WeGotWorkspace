<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Tasks;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\TaskTextPutRequest;
use App\Http\Support\CollabStateResponse;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Tasks\TaskTextCollaboration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Live title and description of a task (#2208), mirroring the Notes collab routes. */
final class TaskTextController
{
    public function __construct(private readonly TaskTextCollaboration $text) {}

    public function show(Request $request, string $taskId): Response
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        if ($request->query('format') === 'yjs') {
            return CollabStateResponse::make($request, $this->text->yjsSnapshot($principal['username'], $taskId));
        }

        $text = $this->text->text($principal['username'], $taskId);

        return response()->json([
            'title' => $text['title'],
            'description' => $text['description'],
            'room' => $text['room'],
            'objectEtag' => $text['objectEtag'],
        ])->header('ETag', $text['contentTag']);
    }

    public function update(TaskTextPutRequest $request, string $taskId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $etag = $this->text->put(
            $principal['username'],
            $taskId,
            $request->title(),
            $request->description(),
            $request->yjsBytes(),
            self::header($request, 'If-Match'),
            self::header($request, 'If-None-Match'),
            self::header($request, CollabExternalWrite::HEADER),
        );

        return response()->json(['ok' => true])->header('ETag', $etag);
    }

    private static function header(Request $request, string $name): ?string
    {
        $value = $request->header($name);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
