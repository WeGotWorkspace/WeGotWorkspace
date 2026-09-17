<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class DocsThreadCreateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id' => ['required', 'string', 'max:26'],
            'kind' => ['required', 'string', 'in:comment,suggestion'],
            'body' => ['present', 'nullable', 'string'],
            'changeId' => ['sometimes', 'nullable', 'string', 'max:128'],
            'anchorText' => ['sometimes', 'nullable', 'string'],
            'anchorFrom' => ['sometimes', 'nullable', 'integer'],
            'anchorTo' => ['sometimes', 'nullable', 'integer'],
            'anchorOccurrence' => ['sometimes', 'nullable', 'integer'],
        ];
    }
}
