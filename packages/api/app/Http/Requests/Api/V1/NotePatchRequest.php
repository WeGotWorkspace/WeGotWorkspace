<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class NotePatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'notebookId' => ['sometimes', 'string', 'min:1'],
            'title' => ['sometimes', 'nullable', 'string', 'max:1024'],
            'body' => ['sometimes', 'string'],
            'categories' => ['sometimes', 'array'],
            'categories.*' => ['string', 'max:255'],
            'status' => ['sometimes', 'nullable', 'in:FINAL,CANCELLED'],
        ];
    }
}
