<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array{access_token: string, refresh_token: string, token_type: string, expires_in: int, refresh_expires_in: int, role: string, username: string}
 */
final class AuthTokenResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'access_token' => $this->resource['access_token'],
            'refresh_token' => $this->resource['refresh_token'],
            'token_type' => $this->resource['token_type'],
            'expires_in' => $this->resource['expires_in'],
            'refresh_expires_in' => $this->resource['refresh_expires_in'],
            'role' => $this->resource['role'],
            'username' => $this->resource['username'],
        ];
    }
}
