<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class SettingsProfileRequest extends FormRequest
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
        return [
            'displayName' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'string', 'max:255'],
            'password' => ['sometimes', 'nullable', 'string', 'min:10', 'max:4096'],
            'currentPassword' => ['required_with:password,email', 'string', 'max:4096'],
        ];
    }
}
