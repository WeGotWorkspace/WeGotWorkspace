<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class AdminGroupCreateRequest extends FormRequest
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
            'slug' => ['sometimes', 'nullable', 'string', 'max:63'],
            'name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'displayName' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    public function slugValue(): string
    {
        $validated = $this->validated();

        $slug = trim(is_string($validated['slug'] ?? null) ? $validated['slug'] : '');
        if ($slug !== '') {
            return $slug;
        }

        $name = trim(is_string($validated['name'] ?? null) ? $validated['name'] : '');
        if ($name !== '') {
            return $name;
        }

        $displayName = $validated['displayName'] ?? null;

        return trim(is_string($displayName) ? $displayName : '');
    }

    public function displayNameValue(): string
    {
        $displayName = trim((string) ($this->input('displayName') ?? ''));
        if ($displayName !== '') {
            return $displayName;
        }

        return trim((string) ($this->input('name') ?? ''));
    }
}
