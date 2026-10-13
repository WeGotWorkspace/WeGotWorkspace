<?php

declare(strict_types=1);

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\HttpException;

final class ApiHttpException extends HttpException
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
}
