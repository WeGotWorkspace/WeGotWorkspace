<?php

declare(strict_types=1);

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The API error for everything except the realtime routes. Body:
 * `{ error: <sentence>, code?: <machine code> }`. Laravel does not report it
 * (it is an `HttpException`).
 */
final class ApiHttpException extends HttpException implements RendersApiError
{
    /**
     * @param  list<string>  $invalidProperties  Offending property paths for validation
     *                                           failures (JMAP `invalidProperties` SetError).
     * @param  array<string, string|int>  $headers
     */
    public function __construct(
        int $statusCode,
        string $message,
        private readonly ?string $apiErrorCode = null,
        private readonly array $invalidProperties = [],
        array $headers = [],
    ) {
        parent::__construct($statusCode, $message, null, $headers);
    }

    public function errorCode(): ?string
    {
        return $this->apiErrorCode;
    }

    /**
     * @return list<string>
     */
    public function invalidProperties(): array
    {
        return $this->invalidProperties;
    }

    public function apiErrorStatus(): int
    {
        return $this->getStatusCode();
    }

    public function apiErrorBody(): array
    {
        $body = ['error' => $this->getMessage()];
        if ($this->apiErrorCode !== null) {
            $body['code'] = $this->apiErrorCode;
        }

        return $body;
    }

    public function apiErrorHeaders(): array
    {
        return $this->getHeaders();
    }
}
