<?php

declare(strict_types=1);

namespace App\Exceptions;

/**
 * An exception that becomes an API error response.
 *
 * `bootstrap/app.php` has one render hook for this contract. The body always
 * carries `error` (string) and, when there is one, `code` (stable machine
 * code). Clients classify on the HTTP status and `code`, never on text.
 * Contract: `.agents/skills/api/rest-design.md`.
 */
interface RendersApiError
{
    public function apiErrorStatus(): int;

    /**
     * @return array{error: string, code?: string, message?: string}
     */
    public function apiErrorBody(): array;

    /**
     * @return array<string, string|int>
     */
    public function apiErrorHeaders(): array;
}
