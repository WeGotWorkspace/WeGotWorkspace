<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class CalendarSchedulingNotificationRespondRequest extends FormRequest
{
    use NarrowsValidatedInput;

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

    /**
     * @return array{participationStatus: string, calendarId?: string|null, recurrenceId?: string|null, scope?: string|null}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $payload = [
            'participationStatus' => $this->requiredString($validated['participationStatus'] ?? null),
        ];
        if (array_key_exists('calendarId', $validated)) {
            $payload['calendarId'] = $this->nullableString($validated['calendarId']);
        }
        if (array_key_exists('recurrenceId', $validated)) {
            $payload['recurrenceId'] = $this->nullableString($validated['recurrenceId']);
        }
        if (array_key_exists('scope', $validated)) {
            $payload['scope'] = $this->nullableString($validated['scope']);
        }

        return $payload;
    }
}
