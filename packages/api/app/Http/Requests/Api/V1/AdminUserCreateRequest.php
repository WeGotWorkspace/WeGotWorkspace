<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class AdminUserCreateRequest extends FormRequest
{
    use NarrowsValidatedInput;

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
            'username' => ['required', 'string', 'max:63', 'regex:/^[a-z0-9][a-z0-9_-]{1,62}$/'],
            'password' => ['required', 'string', 'min:10', 'max:4096'],
            'displayName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'string', 'max:255'],
            'groups' => ['sometimes', 'array'],
            'groups.*' => ['string', 'max:255'],
        ];
    }

    /**
     * @return array{username: string, password: string, displayName: string, email: string|null, groups: list<string>}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $email = $validated['email'] ?? null;

        return [
            'username' => $this->requiredString($validated['username'] ?? null),
            'password' => $this->requiredString($validated['password'] ?? null),
            'displayName' => trim(is_string($validated['displayName'] ?? null) ? $validated['displayName'] : ''),
            'email' => is_string($email) ? trim($email) : null,
            'groups' => $this->stringList($validated['groups'] ?? []),
        ];
    }
}
