<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class ChatDmOpenRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // Shape only — semantic checks (self, groups, unknown users) live in
        // ChatChannelRepository::openDm with field-specific error payloads.
        return [
            'principal' => ['required', 'string', 'min:1', 'max:190'],
        ];
    }
}
