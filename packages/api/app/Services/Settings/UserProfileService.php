<?php

declare(strict_types=1);

namespace App\Services\Settings;

use App\Exceptions\ApiHttpException;
use App\Models\Principal;
use App\Models\User;

final class UserProfileService
{
    public function updateProfile(string $username, string $displayName, ?string $email): void
    {
        $principal = Principal::forUsername($username);
        if ($principal === null) {
            throw new ApiHttpException(400, 'No principal row for this user (contacts/calendars may be disabled).', 'bad_request');
        }
        $principal->displayname = $displayName !== '' ? $displayName : null;
        $principal->email = $email !== null && $email !== '' ? $email : null;
        $principal->save();
    }

    public function updatePassword(string $username, string $password): void
    {
        if (strlen($password) < 10) {
            throw new ApiHttpException(400, 'Use a password of at least 10 characters.', 'bad_request');
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $updated = User::query()->where('username', $username)->update(['digest' => $hash]);
        if ($updated === 0) {
            throw new ApiHttpException(400, 'User not found.', 'bad_request');
        }
    }
}
