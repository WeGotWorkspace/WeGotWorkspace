<?php

declare(strict_types=1);

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\HttpException;

final class ApiHttpException extends HttpException
{
    /**
     * @param  list<string>  $invalidProperties  Offending property paths for validation
     *                                           failures (JMAP `invalidProperties` SetError).
     */
    public function __construct(
        int $statusCode,
        string $message,
        private readonly ?string $apiErrorCode = null,
        private readonly array $invalidProperties = [],
    ) {
        parent::__construct($statusCode, $message);
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
