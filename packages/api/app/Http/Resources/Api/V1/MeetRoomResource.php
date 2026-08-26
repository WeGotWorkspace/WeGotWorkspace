<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
final class MeetRoomResource extends JsonResource
{
    public function __construct(
        private readonly bool $includeOwnerFields,
        mixed $resource,
    ) {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $body = [
            'reserved' => true,
            'active' => (bool) $this->resource['active'],
        ];

        if (array_key_exists('roomId', $this->resource)) {
            $body['roomId'] = $this->resource['roomId'];
        }

        if ($this->includeOwnerFields) {
            $body['ownerPrincipal'] = $this->resource['ownerPrincipal'];
            $body['createdBy'] = $this->resource['createdBy'];
            $body['expiresAt'] = $this->resource['expiresAt'];
        }

        return $body;
    }
}
