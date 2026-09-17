<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class SettingsMailRequest extends FormRequest
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
            'imapUsername' => ['sometimes', 'string', 'max:255'],
            'imapPassword' => ['sometimes', 'nullable', 'string', 'max:4096'],
            'imapHost' => ['sometimes', 'nullable', 'string', 'max:255'],
            'imapPort' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:65535'],
            'imapSecurity' => ['sometimes', 'nullable', 'string', 'max:16'],
            'smtpHost' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtpPort' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:65535'],
            'smtpSecurity' => ['sometimes', 'nullable', 'string', 'max:16'],
            'smtpUsername' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtpPassword' => ['sometimes', 'nullable', 'string', 'max:4096'],
            'clearImapPassword' => ['sometimes', 'boolean'],
            'clearSmtpPassword' => ['sometimes', 'boolean'],
        ];
    }
}
