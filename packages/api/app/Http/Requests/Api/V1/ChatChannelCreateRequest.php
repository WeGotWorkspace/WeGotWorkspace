<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class ChatChannelCreateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'kind' => ['required', 'string', 'in:channel,meeting,dm'],
            'color' => ['sometimes', 'nullable', 'string', 'max:64'],
            'topic' => ['sometimes', 'nullable', 'string', 'max:1024'],
            'groupSlug' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Za-z0-9._-]{1,190}$/'],
            'id' => ['sometimes', 'string', 'max:190', 'regex:/^[A-Za-z0-9._-]+$/'],
        ];
    }
}
