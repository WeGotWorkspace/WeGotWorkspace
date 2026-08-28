<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class NotebookPatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4096'],
            'color' => ['sometimes', 'nullable', 'string', 'max:64'],
            'groupSlug' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Za-z0-9._-]{1,190}$/'],
            'shareWith' => ['sometimes', 'nullable', 'array'],
        ];
    }
}
