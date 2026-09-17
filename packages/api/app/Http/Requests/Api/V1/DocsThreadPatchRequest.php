<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class DocsThreadPatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'resolved' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
            'changeId' => ['sometimes', 'nullable', 'string', 'max:128'],
            'anchorText' => ['sometimes', 'nullable', 'string'],
            'anchorFrom' => ['sometimes', 'nullable', 'integer'],
            'anchorTo' => ['sometimes', 'nullable', 'integer'],
        ];
    }
}
