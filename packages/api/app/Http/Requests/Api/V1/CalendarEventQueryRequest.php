<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/** JMAP CalendarEvent/query body. */
final class CalendarEventQueryRequest extends FormRequest
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
            'filter' => ['required', 'array'],
            'filter.inCalendars' => ['required', 'array', 'min:1'],
            'filter.inCalendars.*' => ['string', 'regex:/^[a-z0-9_-]+$/', 'max:255'],
            'filter.after' => ['sometimes', 'string', 'date', 'required_with:filter.before'],
            'filter.before' => ['sometimes', 'string', 'date', 'required_with:filter.after'],
            'filter.title' => ['sometimes', 'string', 'max:1024'],
            'sort' => ['sometimes', 'array'],
            'sort.*.property' => ['required', 'string', 'in:start,title,uid'],
            'sort.*.isAscending' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }
}
