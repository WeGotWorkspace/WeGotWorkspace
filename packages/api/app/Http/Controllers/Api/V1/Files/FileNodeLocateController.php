<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Drive\DriveFileNodeLocator;
use App\Services\Drive\DriveForbiddenException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /files/node?id=fn-… or ?path=/… → `{data: {id, path}}` (#1751).
 * Signed-in users only; guests stay on paths.
 */
final class FileNodeLocateController
{
    public function __construct(private DriveFileNodeLocator $locator) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $id = $this->queryString($request, 'id');
        $path = $this->queryString($request, 'path');
        if ($id === null && $path === null) {
            throw new ApiHttpException(400, 'Missing id or path query parameter.', 'bad_request');
        }

        try {
            $location = $id !== null
                ? $this->locator->locateById($principal, $id)
                : $this->locator->locateByPath($principal, (string) $path);
        } catch (DriveForbiddenException $e) {
            throw new ApiHttpException(403, $e->getMessage(), 'forbidden');
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        } catch (\RuntimeException $e) {
            throw new ApiHttpException(404, $e->getMessage(), 'not_found');
        }

        return response()->json(['data' => $location]);
    }

    private function queryString(Request $request, string $name): ?string
    {
        $value = $request->query($name);
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }
}
