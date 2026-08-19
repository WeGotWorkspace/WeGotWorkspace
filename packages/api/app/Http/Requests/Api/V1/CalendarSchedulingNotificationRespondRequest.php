<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class CalendarSchedulingNotificationRespondRequest extends FormRequest
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
            'participationStatus' => ['required', 'string', Rule::in(['accepted', 'tentative', 'declined'])],
            'calendarId' => ['sometimes', 'nullable', 'string', 'max:255'],
            'recurrenceId' => ['sometimes', 'nullable', 'string', 'max:64'],
            'scope' => ['sometimes', 'nullable', 'string', Rule::in(['this', 'future'])],
        ];
    }
}
