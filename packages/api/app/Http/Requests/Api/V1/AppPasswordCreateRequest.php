<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class AppPasswordCreateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $name = $this->input('name');
        if (is_string($name)) {
            $this->merge(['name' => trim($name)]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:60'],
            // One of the two, decided by the controller: `code` when the
            // caller has two-factor on, `currentPassword` otherwise.
            'currentPassword' => ['sometimes', 'nullable', 'string', 'max:4096'],
            'code' => ['sometimes', 'nullable', 'string', 'max:32'],
        ];
    }
}
