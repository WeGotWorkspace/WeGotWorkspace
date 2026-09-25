<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH body for partial Task updates.
 */
final class TaskPatchRequest extends FormRequest
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
        return array_merge($this->writableFieldRules(), [
            '@type' => ['prohibited'],
            'id' => ['prohibited'],
            'taskListId' => ['prohibited'],
            'taskListIds' => ['prohibited'],
            'isDraft' => ['prohibited'],
            'sortOrder' => ['prohibited'],
            'uid' => ['prohibited'],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function writableFieldRules(): array
    {
        return [
            'title' => ['sometimes', 'string', 'min:1', 'max:4096'],
            'description' => ['sometimes', 'nullable', 'string', 'max:8192'],
            'start' => ['sometimes', 'nullable', 'string'],
            'due' => ['sometimes', 'nullable', 'string'],
            'completed' => ['sometimes', 'nullable', 'string'],
            'workflowStatus' => [
                'sometimes',
                'nullable',
                'string',
                Rule::in(['needs-action', 'in-process', 'completed', 'cancelled', 'pending', 'failed']),
            ],
            'progress' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100'],
            'priority' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:9'],
            'categories' => ['sometimes', 'array'],
            'categories.*' => ['string', 'max:255'],
            'privacy' => [
                'sometimes',
                'nullable',
                'string',
                Rule::in(['public', 'private', 'secret']),
            ],
            'recurrenceRules' => ['sometimes', 'array'],
            'excludedRecurrenceDates' => ['sometimes', 'array'],
            'recurrenceOverrides' => ['sometimes', 'array'],
            'alerts' => ['sometimes', 'nullable', 'array'],
            'showWithoutTime' => ['sometimes', 'boolean'],
            'timeZone' => ['sometimes', 'nullable', 'string', 'max:255'],
            'participants' => ['sometimes', 'array'],
            'icsProps' => ['sometimes', 'array'],
        ];
    }
}
