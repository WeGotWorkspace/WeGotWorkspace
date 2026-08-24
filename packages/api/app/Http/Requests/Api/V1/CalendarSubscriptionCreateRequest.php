<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class CalendarSubscriptionCreateRequest extends FormRequest
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
            'url' => ['required', 'string', 'min:1'],
            'name' => ['sometimes', 'nullable', 'string', 'min:1', 'max:255'],
            'color' => ['sometimes', 'nullable', 'string', 'max:32'],
            'groupSlug' => ['sometimes', 'nullable', 'string', 'min:1', 'max:64'],
        ];
    }
}
