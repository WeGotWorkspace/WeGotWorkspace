<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class TaskItemQueryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'filter' => ['required', 'array'],
            'filter.inTaskList' => ['required', 'string', 'regex:/^[a-z0-9_-]+$/', 'max:255'],
            'filter.uid' => ['sometimes', 'string', 'max:1024'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }
}
