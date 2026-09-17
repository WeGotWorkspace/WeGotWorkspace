<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class ChatMessageCreateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id' => ['required', 'string', 'max:26'],
            'body' => ['required', 'string', 'min:1'],
            'parentId' => ['sometimes', 'nullable', 'string', 'max:26'],
        ];
    }
}
