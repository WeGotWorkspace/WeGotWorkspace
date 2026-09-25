<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST/PUT body for Task upsert.
 */
final class TaskUpsertRequest extends FormRequest
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
        return $this->isMethod('POST')
            ? $this->storeRules()
            : $this->updateRules();
    }

    /**
     * @return array<string, mixed>
     */
    private function storeRules(): array
    {
        return array_merge($this->writableFieldRules(), [
            '@type' => ['prohibited'],
            'id' => ['prohibited'],
            'taskListId' => ['prohibited'],
            'isDraft' => ['prohibited'],
            'sortOrder' => ['prohibited'],
            'taskListIds' => ['required', 'array', 'min:1'],
            'title' => ['required', 'string', 'min:1', 'max:4096'],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function updateRules(): array
    {
        return array_merge($this->writableFieldRules(), [
            '@type' => ['prohibited'],
            'id' => ['sometimes', 'string', 'max:255'],
            'taskListId' => ['prohibited'],
            'isDraft' => ['prohibited'],
            'sortOrder' => ['prohibited'],
            'taskListIds' => ['sometimes', 'array'],
            'title' => ['required', 'string', 'min:1', 'max:4096'],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function writableFieldRules(): array
    {
        return [
            'uid' => ['sometimes', 'string', 'max:255'],
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
            'created' => ['sometimes', 'nullable', 'string'],
            'updated' => ['sometimes', 'nullable', 'string'],
            'recurrenceRules' => ['sometimes', 'array'],
            'excludedRecurrenceDates' => ['sometimes', 'array'],
            'recurrenceOverrides' => ['sometimes', 'array'],
            'alerts' => ['sometimes', 'array'],
            'showWithoutTime' => ['sometimes', 'boolean'],
            'timeZone' => ['sometimes', 'nullable', 'string', 'max:255'],
            'participants' => ['sometimes', 'array'],
            'icsProps' => ['sometimes', 'array'],
        ];
    }
}
