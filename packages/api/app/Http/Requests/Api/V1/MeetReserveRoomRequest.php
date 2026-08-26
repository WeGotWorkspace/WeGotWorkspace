<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Services\Meet\MeetReservationService;
use Illuminate\Foundation\Http\FormRequest;

final class MeetReserveRoomRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'room' => ['required', 'string', 'regex:'.MeetReservationService::ROOM_ID_PATTERN],
            'ownerPrincipal' => ['required', 'string', 'regex:'.MeetReservationService::OWNER_PRINCIPAL_PATTERN],
            'expiresAt' => ['sometimes', 'nullable', 'date'],
        ];
    }
}
